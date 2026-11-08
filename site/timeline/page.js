(async function () {
  const [albums, index, milestones] = await Promise.all([D.albums(),D.get("/data/index.json"),D.get("/data/milestones.json")]);
  const releases = albums.map(a => ({
    date:a.d, kind:"Album", title:a.t, note:a.note,
    link:"/album/?a="+encodeURIComponent(a.s)
  }));
  const years = [...new Set([...Object.keys(index.years), ...[...milestones,...releases].map(e => e.date.slice(0,4))])].sort();
  const yearSelect = document.querySelector("#year"), kindSelect = document.querySelector("#kind"), list = document.querySelector("#years-list");
  for (const year of years) yearSelect.add(new Option(year,year));
  function events(year,kind) {
    const rows = kind === "Concerts" ? [] : kind === "Albums" ? releases : kind === "Awards" ? milestones.filter(e => e.kind === "Award") :
      kind === "Milestones" ? milestones.filter(e => e.kind !== "Award") : [...milestones,...releases];
    return rows.filter(e => e.date.startsWith(year));
  }
  const rail = document.querySelector("#rail");
  const decades = document.querySelector("#decades");
  const decadeOf = year => Math.floor(Number(year) / 10) * 10;
  let decade = decadeOf(years.includes(D.qs("y")) ? D.qs("y") : "1960");
  const covers = new Map(albums.map(a => ["/album/?a="+encodeURIComponent(a.s), a.s]));
  for (const d of [...new Set(years.map(decadeOf))]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = d+"s";
    button.dataset.decade = String(d);
    decades.append(button);
  }
  function relatedLinks(e) {
    if (!e.related) return "";
    const links = e.related.map(r=>'<a href="'+D.esc(r.href)+'">'+D.esc(r.label)+'</a>').join("");
    return '<div class="related-links">'+links+'<a href="'+D.esc(e.source)+'">Historical source · Smithsonian</a></div>';
  }
  function drawRail() {
    const kind = kindSelect.value;
    for(const button of decades.children) button.setAttribute("aria-pressed", Number(button.dataset.decade) === decade);
    const blocks = years.filter(y => decadeOf(y) === decade).map(year => {
      const items = events(year,kind).sort((a,b)=>a.date.localeCompare(b.date));
      const shows = (!kind || kind === "Concerts") ? index.years[year] || 0 : 0;
      if(!items.length && !shows) return "";
      const cards = items.map(e => {
        const slug = covers.get(e.link);
        const art = slug ? '<img src="/covers/'+D.esc(slug)+'.webp" loading="lazy" width="54" height="54" alt="">' : "";
        const anchor = e.kind === "Album" ? "" : ' id="milestone-'+D.slug(e.title)+'"';
        if(e.related) return '<article class="rail-card linked-milestone"'+anchor+'><small>'+D.esc(e.kind)+' · '+readable(e.date)+'</small><strong>'+D.esc(e.title)+'</strong><p>'+D.esc(e.note)+'</p>'+relatedLinks(e)+'</article>';
        const tag = (e.link || e.source) ? 'a href="'+D.esc(e.link || e.source)+'"' : 'div';
        return '<'+tag+anchor+' class="rail-card">'+art+'<span><small>'+
          D.esc(e.kind)+(e.date.length>4?' · '+readable(e.date):'')+'</small><strong>'+D.esc(e.title)+'</strong></span></'+tag.split(" ")[0]+'>';
      }).join("");
      const concerts = shows ? '<button type="button" class="rail-shows" data-year="'+year+'">'+shows+' '+(shows===1?'concert':'concerts')+' →</button>' : "";
      return '<div class="rail-year"><div class="rail-date"><button type="button" data-year="'+year+'" aria-label="Open events for '+year+'">'+year+'</button></div><div class="rail-entries">'+cards+concerts+'</div></div>';
    }).join("");
    rail.innerHTML = blocks || '<p class="muted">No matching events in the '+decade+'s.</p>';
  }
  decades.addEventListener("click",event=>{
    const button = event.target.closest("button[data-decade]");
    if(!button) return;
    decade = Number(button.dataset.decade);
    yearSelect.value = "";
    render();
  });
  rail.addEventListener("click",event=>{
    const button = event.target.closest("button[data-year]");
    if(!button) return;
    yearSelect.value = button.dataset.year;
    if(button.classList.contains("rail-shows")) kindSelect.value = "Concerts";
    render();
    document.querySelector("#archive-heading").focus();
    document.querySelector("#archive-heading").scrollIntoView({block:"start"});
  });
  function readable(date) {
    if(date.length === 4) return date;
    const full = date.length === 7;
    return new Intl.DateTimeFormat("en-GB",{year:"numeric",month:"short",day:full?undefined:"numeric",timeZone:"UTC"}).format(new Date((full?date+"-01":date)+"T00:00:00Z"));
  }
  function row(e) {
    const title=e.link ? '<a href="'+D.esc(e.link)+'">'+D.esc(e.title)+'</a>' : D.esc(e.title);
    return '<article class="timeline-event"><time datetime="'+D.esc(e.date)+'">'+readable(e.date)+'</time><div><small class="muted">'+D.esc(e.kind)+'</small><h3>'+title+'</h3>'+
      (e.note?'<p>'+D.esc(e.note)+'</p>':'')+(e.related?relatedLinks(e):e.source?'<a class="small" href="'+D.esc(e.source)+'">Source</a>':'')+'</div></article>';
  }
  function render() {
    const kind=kindSelect.value, showConcerts=!kind || kind==="Concerts";
    if(yearSelect.value) decade=decadeOf(yearSelect.value);
    drawRail();
    let total=0;
    list.replaceChildren();
    for(const year of years.filter(y=>!yearSelect.value || yearSelect.value===y)){
      const fixed=events(year,kind);
      const concerts=showConcerts ? index.years[year] || 0 : 0;
      const count=fixed.length+concerts;
      if(!count) continue;
      total+=count;
      const group=document.createElement("details");
      group.className="timeline-year";
      group.innerHTML='<summary>'+year+'<small>'+count+' '+(count===1?'event':'events')+'</small></summary><div></div>';
      const content=group.lastElementChild;
      let populated=false;
      async function expand() {
        if(!group.open || populated) return;
        populated=true;
        content.textContent="Loading…";
        try {
          const shows=concerts ? await D.get("/data/years/"+year+".json") : [];
          const rows=[...fixed,...shows.map(s=>({date:s.d,kind:"Concert",title:s.v,note:D.place(s),link:"/concert/?id="+encodeURIComponent(s.id)}))];
          content.innerHTML=rows.sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title)).map(row).join("");
        } catch {
          populated=false;
          content.innerHTML=fixed.map(row).join("")+'<p>Concert records could not load. <a href="/concerts/?y='+year+'">Open the concert archive</a>.</p>';
        }
      }
      group.addEventListener("toggle",expand);
      list.append(group);
      if(yearSelect.value || list.childElementCount===1) group.open=true;
    }
    document.querySelector("#count").textContent=total+" "+(total===1?"event":"events");
    if(!total) list.textContent="No events match this selection.";
  }
  if(years.includes(D.qs("y"))) yearSelect.value=D.qs("y");
  yearSelect.addEventListener("change",render);kindSelect.addEventListener("change",render);render();
  document.querySelector("#status").hidden=true;
  if(location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
})().catch(() => {document.querySelector("#status").textContent="The timeline could not load. Please reload the page.";});
