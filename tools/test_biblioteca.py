import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from PIL import Image
from build_eink import validate_pack
from build_pages import build
from import_books import process_requests

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = {'title':'Biblioteca','extra':'conservato','manga':[{'id':'esistente','title':'Libro esistente','cover':'manga/esistente/cover.png','chapters':[{'id':'chapter-1','title':'Capitolo','pages':['manga/esistente/chapter-1/001.png']}]}]}


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.repo = Path(self.temporary.name) / 'repo'
        self.repo.mkdir()
        self.original_font_dir = os.environ.get('BIBLIOTECA_FONT_DIR')
        shutil.copytree(ROOT / 'biblioteca/fonts', self.repo / 'biblioteca/fonts')
        (self.repo / 'eink').mkdir()
        self.manifest = self.repo / 'manifest.json'
        self.manifest.write_text(json.dumps(FIXTURE), encoding='utf-8')
        (self.repo / 'eink/catalog.tsv').write_text('MANGA1\nesistente\tLibro esistente\t1\n', encoding='utf-8')
        self.original = self.repo / 'manga/esistente/chapter-1/001.png'
        self.original.parent.mkdir(parents=True)
        self.original.write_bytes(b'original image untouched')

    def tearDown(self):
        if self.original_font_dir is None:
            os.environ.pop('BIBLIOTECA_FONT_DIR', None)
        else:
            os.environ['BIBLIOTECA_FONT_DIR'] = self.original_font_dir
        self.temporary.cleanup()

    def request(self, identifier='a'*64, text=None, **overrides):
        folder = self.repo / 'biblioteca-input' / identifier
        folder.mkdir(parents=True)
        settings = {'version':1,'title':'Caffè e città','author':'Autore','font_size':18,'pages_per_part':50,'preserve_lines':False,**overrides}
        (folder / 'richiesta.json').write_text(json.dumps(settings), encoding='utf-8')
        (folder / 'testo.txt').write_bytes(text or ('Perché leggere? È un piacere.\n\n' + 'Una storia con accenti e parole. '*250).encode('utf-8'))
        return self.repo / 'biblioteca-stato' / (identifier+'.json')

    def test_import_preserves_catalogue_and_generates_valid_pages(self):
        receipt = self.request()
        self.assertEqual(process_requests(self.repo, lambda _:None),1)
        status=json.loads(receipt.read_text(encoding='utf-8'))
        self.assertEqual(status['state'],'ready')
        catalog=json.loads(self.manifest.read_text(encoding='utf-8'))
        self.assertEqual(catalog['manga'][0],FIXTURE['manga'][0])
        self.assertEqual(catalog['extra'],'conservato')
        self.assertEqual(self.original.read_bytes(),b'original image untouched')
        book=catalog['manga'][1]
        for chapter in book['chapters']:
            pack=self.repo/'eink'/book['id']/(chapter['id']+'.mgz')
            self.assertEqual(validate_pack(pack),len(chapter['pages']))
            for page in chapter['pages']:
                with Image.open(self.repo/page) as image:
                    self.assertEqual(image.size,(280,460))
        generated=(self.repo/'biblioteca-generated-files.txt').read_text(encoding='utf-8').splitlines()
        self.assertIn('manifest.json',generated)
        self.assertNotIn('manga/esistente/chapter-1/001.png',generated)
        self.assertNotIn('biblioteca', [book['id'] for book in catalog['manga']])
        self.assertNotIn('biblioteca', (self.repo/'eink/catalog.tsv').read_text(encoding='utf-8'))

    def test_repeat_request_and_same_edition_do_not_duplicate(self):
        self.request()
        self.assertEqual(process_requests(self.repo,lambda _:None),1)
        self.assertEqual(process_requests(self.repo,lambda _:None),0)
        receipt=self.request('b'*64)
        self.assertEqual(process_requests(self.repo,lambda _:None),0)
        self.assertEqual(json.loads(receipt.read_text())['state'],'ready')
        self.assertEqual(len(json.loads(self.manifest.read_text(encoding='utf-8'))['manga']),2)

    def test_bad_input_has_error_receipt_and_preserves_existing_data(self):
        receipt=self.request(text=b'\x00binary')
        original=self.manifest.read_bytes()
        self.assertEqual(process_requests(self.repo,lambda _:None),0)
        self.assertEqual(json.loads(receipt.read_text())['state'],'error')
        self.assertEqual(self.manifest.read_bytes(),original)
        self.assertEqual((self.repo/'biblioteca-generated-files.txt').read_text().splitlines(),['biblioteca-stato/'+'a'*64+'.json'])

    def test_rejects_unexpected_fields(self):
        receipt=self.request(path='../../other')
        process_requests(self.repo,lambda _:None)
        self.assertEqual(json.loads(receipt.read_text())['state'],'error')

    def test_small_site_omits_uploads_and_reading_assets(self):
        self.request()
        process_requests(self.repo,lambda _:None)
        for name in ('index.html','app.js','styles.css','.nojekyll'):
            (self.repo/name).write_text('original frontend',encoding='utf-8')
        shutil.copyfile(ROOT/'biblioteca/index.html',self.repo/'biblioteca/index.html')
        destination=Path(self.temporary.name)/'site'
        size=build(self.repo,destination)
        self.assertLess(size,1_000_000)
        self.assertFalse((destination/'manga').exists())
        self.assertFalse((destination/'biblioteca-input').exists())
        catalogue=json.loads((destination/'manifest.json').read_text(encoding='utf-8'))
        self.assertTrue(catalogue['manga'][0]['chapters'][0]['pages'][0].startswith('https://raw.githubusercontent.com/'))
        self.assertEqual((destination/'app.js').read_text(),'original frontend')

    def test_sparse_publication_never_deletes_original_images(self):
        git=shutil.which('git')
        portable=ROOT.parent/'manga_tools/.tools/git/cmd/git.exe'
        if not git and portable.is_file(): git=str(portable)
        if not git: self.skipTest('Git not installed')
        def run(*args,cwd=None):
            return subprocess.check_output([git,*args],cwd=cwd or self.repo,stderr=subprocess.STDOUT,encoding='utf-8')
        run('init','-b','main')
        run('config','user.name','Test')
        run('config','user.email','test@example.invalid')
        run('add','.')
        run('commit','-m','Original')
        clone=Path(self.temporary.name)/'clone'
        run('clone','--no-checkout',str(self.repo),str(clone))
        run('config','core.sparseCheckout','true',cwd=clone)
        (clone/'.git/info/sparse-checkout').write_text('/manifest.json\n/biblioteca/\n/eink/catalog.tsv\n',encoding='utf-8')
        run('read-tree','-mu','HEAD',cwd=clone)
        self.assertFalse((clone/'manga').exists())
        self.request()
        shutil.copytree(self.repo/'biblioteca-input',clone/'biblioteca-input')
        process_requests(clone,lambda _:None)
        run('add','--sparse','--pathspec-from-file=biblioteca-generated-files.txt',cwd=clone)
        self.assertEqual(run('diff','--cached','--diff-filter=D','--name-only',cwd=clone),'')
        self.assertEqual(run('show',':manga/esistente/chapter-1/001.png',cwd=clone).strip(),'original image untouched')


if __name__=='__main__': unittest.main()
