/* TXT decoding and local preview. No network and no credentials here. */
(() => {
  'use strict';
  const WIDTH = 252;
  function decode(bytes) {
    if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('Il TXT supera 20 MB. Dividilo in più volumi.');
    let text;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le', {fatal:true}).decode(bytes);
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be', {fatal:true}).decode(bytes);
    else {
      if (bytes.includes(0)) throw new Error('Questo file contiene dati binari. Scegli un TXT UTF-8.');
      try { text = new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
      catch { text = new TextDecoder('windows-1252').decode(bytes); }
    }
    text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').normalize('NFC').replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f]/g, '');
    if (!text.trim()) throw new Error('Il file non contiene testo.');
    return text;
  }
  function validate(options) {
    if (!options.title.trim() || new TextEncoder().encode(options.title.trim()).length > 150) throw new Error('Inserisci un titolo di massimo 150 byte (circa 150 lettere).');
    if (/[\r\n\t]/.test(options.title + options.author)) throw new Error('Titolo e autore devono stare su una sola riga.');
    if ([...options.author].length > 120) throw new Error('Il nome dell’autore è troppo lungo.');
    if (![16,18,20,22].includes(options.font_size) || ![50,100,200].includes(options.pages_per_part)) throw new Error('Impostazioni non valide.');
    if (typeof options.preserve_lines !== 'boolean') throw new Error('Impostazioni non valide.');
  }
  function wrap(text, measure, width=WIDTH) {
    const lines = []; let line = '';
    for (const word of text.trim().split(/\s+/).filter(Boolean)) {
      if (measure(word) > width) {
        if (line) lines.push(line);
        line = '';
        for (const character of word) {
          if (line && measure(line + character) > width) { lines.push(line); line = character; }
          else line += character;
        }
      } else {
        const candidate = line + (line ? ' ' : '') + word;
        if (line && measure(candidate) > width) { lines.push(line); line = word; }
        else line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  async function layout(text, options) {
    validate(options);
    await document.fonts.load(`${options.font_size}px Atkinson`);
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${options.font_size}px Atkinson`;
    const measure = line => context.measureText(line).width;
    const metadata = await fetch('fonts/metrics.json').then(response => { if (!response.ok) throw new Error('Carattere non disponibile. Ricarica la pagina.'); return response.json(); });
    const lineHeight = metadata[String(options.font_size)].line_height;
    const maxLines = Math.floor((426-48)/lineHeight);
    const lines = [];
    if (options.preserve_lines) {
      for (const line of text.replace(/\f/g, '\n\n').split('\n')) { const wrapped=wrap(line,measure); lines.push(...(wrapped.length ? wrapped : [''])); }
    } else {
      for (const paragraph of text.replace(/\f/g, '\n\n').trim().split(/\n[ \t]*\n+/)) {
        if (lines.length) lines.push('');
        lines.push(...wrap(paragraph,measure));
      }
    }
    const pages=[]; let page=[];
    for (let index=0; index<lines.length; index++) {
      const line=lines[index];
      if (!page.length && !line) continue;
      page.push(line);
      if (page.length===maxLines) {pages.push(page);page=[];}
      if (index % 5000 === 4999) await new Promise(resolve => setTimeout(resolve,0));
    }
    while (page.length && !page[page.length-1]) page.pop();
    if (page.length) pages.push(page);
    if (!pages.length) throw new Error('Il file non contiene righe leggibili.');
    if (pages.length > options.pages_per_part*500) throw new Error('Il libro supera 500 parti. Dividilo in più volumi.');
    return {pages,lineHeight};
  }
  function draw(canvas, prepared, index) {
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,280,460);ctx.fillStyle='#000';ctx.textBaseline='top';ctx.textAlign='left';
    ctx.font='11px Atkinson';let title=prepared.options.title;
    if(ctx.measureText(title).width>252){while(title && ctx.measureText(title+'…').width>252)title=title.slice(0,-1);title+='…';}
    ctx.fillText(title,14,12);ctx.fillRect(14,33,252,1);
    ctx.font=`${prepared.options.font_size}px Atkinson`;
    prepared.pages[index].forEach((line,n)=>ctx.fillText(line,14,48+n*prepared.lineHeight));
    ctx.font='11px Atkinson';ctx.textAlign='center';ctx.fillText(`${index+1} / ${prepared.pages.length}`,140,441);
    const image=ctx.getImageData(0,0,280,460);
    for(let offset=0;offset<image.data.length;offset+=4){const value=image.data[offset]>=170?255:0;image.data[offset]=image.data[offset+1]=image.data[offset+2]=value;}
    ctx.putImageData(image,0,0);
  }
  window.Libro=Object.freeze({decode,validate,wrap,layout,draw});
})();
