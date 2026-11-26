(function () {
  "use strict";

  /* Link de convite/recuperação de senha do Supabase cai na raiz: mandar ao painel. */
  if (/(^|[#&?])(access_token|token_hash|code|error_description)=/.test(location.hash.slice(1) + "&" + location.search.slice(1)) &&
      /type=(invite|recovery|signup|magiclink)|code=|error_description=/.test(location.hash + location.search)) {
    location.replace("admin.html" + location.search + location.hash);
    return;
  }

  var NOME_APP = "EduCiência";
  var MSG_INDISPONIVEL = "Curso ainda não disponível";
  var CFG = window.AULAS_CONFIG || {};
  var REST = CFG.supabaseUrl + "/rest/v1/";
  var STORAGE_PUBLICO = CFG.supabaseUrl + "/storage/v1/object/public/materiais/";
  var CHAVE_VISTAS = "aulas.vistas.v1";
  var app = document.getElementById("app");
  var tituloTopo = document.getElementById("titulo-topo");
  var subtituloTopo = document.getElementById("subtitulo-topo");
  var btnVoltar = document.getElementById("btn-voltar");
  var faixa = document.getElementById("faixa-modo");
  var destinoVoltar = "#/";
  var dados = null;

  /* ---------- utilidades ---------- */

  function el(tag, attrs, filhos) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] === undefined || attrs[k] === null || attrs[k] === false) return;
        if (k === "class") n.className = attrs[k];
        else if (k === "text") n.textContent = attrs[k];
        else n.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
      });
    }
    (filhos || []).forEach(function (f) {
      if (f) n.appendChild(typeof f === "string" ? document.createTextNode(f) : f);
    });
    return n;
  }

  function urlSegura(u) {
    try {
      var url = new URL(u, location.href);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch (e) {
      return null;
    }
  }

  /* Converte [palavra](https://endereço) em link. O resto vira texto puro (nunca HTML). */
  function textoComLinks(s) {
    var partes = [];
    var re = /\[([^\[\]\n]{1,200})\]\((https?:\/\/[^\s()]+)\)/gi;
    var inicio = 0, m;
    while ((m = re.exec(s))) {
      var href = urlSegura(m[2]);
      if (!href) continue;
      if (m.index > inicio) partes.push(s.slice(inicio, m.index));
      partes.push(el("a", { href: href, target: "_blank", rel: "noopener noreferrer", text: m[1] }));
      inicio = re.lastIndex;
    }
    if (inicio < s.length) partes.push(s.slice(inicio));
    return partes;
  }

  function lerVistas() {
    try { return JSON.parse(localStorage.getItem(CHAVE_VISTAS)) || {}; } catch (e) { return {}; }
  }
  function gravarVistas(v) {
    try { localStorage.setItem(CHAVE_VISTAS, JSON.stringify(v)); } catch (e) { /* armazenamento indisponível */ }
  }

  function semAcento(s) {
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function porOrdem(x, y) { return (x.ordem || 0) - (y.ordem || 0); }

  function hrefAula(id) { return "#/aula/" + encodeURIComponent(id); }
  function hrefCard(idAula, idCard) { return hrefAula(idAula) + "/card/" + encodeURIComponent(idCard); }

  /* ---------- telas ---------- */

  function cabecalho(titulo, subtitulo, voltarPara) {
    tituloTopo.textContent = titulo;
    subtituloTopo.textContent = subtitulo || "";
    destinoVoltar = voltarPara || "#/";
    btnVoltar.hidden = !voltarPara;
    /* Tela inicial sempre "EduCiência": é o nome que o Android usa se criar atalho pela página. */
    document.title = !voltarPara || titulo === NOME_APP ? NOME_APP : titulo + " · " + NOME_APP;
  }

  /* Aulas que o aluno pode abrir; admin abre todas (prévia). */
  function podeAbrir(a) { return a.disponivel || dados.admin; }

  function telaLista() {
    var curso = dados.curso;
    cabecalho(curso.titulo, curso.professor, null);
    var vistas = lerVistas();
    var liberadas = dados.aulas.filter(function (a) { return a.disponivel; });
    var total = liberadas.length;
    var feitas = liberadas.filter(function (a) { return vistas[a.id]; }).length;

    var busca = el("input", { class: "busca", type: "search", placeholder: "Buscar aula", "aria-label": "Buscar aula" });
    var progresso = el("p", { class: "progresso", text: feitas + " de " + total + " aulas assistidas" });
    var barra = el("div", { class: "barra" }, [el("span")]);
    barra.firstChild.style.width = (total ? Math.round((feitas / total) * 100) : 0) + "%";
    var lista = el("ul", { class: "lista" });

    function desenhar(filtro) {
      lista.textContent = "";
      var f = semAcento(filtro || "").trim();
      var achou = false;
      dados.aulas.forEach(function (a, i) {
        if (f && semAcento(a.titulo + " " + a.descricao).indexOf(f) === -1) return;
        achou = true;
        var vista = a.disponivel && vistas[a.id];
        var chip = !a.disponivel
          ? el("span", { class: "chip chip-estado", text: dados.admin ? "Prévia · indisponível para alunos" : "Em breve" })
          : el("span", { class: "chip", text: a.duracao || "" });
        var miolo = [
          el("div", { class: "num", "aria-hidden": "true", text: vista ? "✓" : String(i + 1) }),
          el("div", null, [el("h2", { text: a.titulo }), el("p", { text: a.descricao }), chip])
        ];
        var card = podeAbrir(a)
          ? el("a", { class: "card-aula" + (vista ? " vista" : "") + (a.disponivel ? "" : " previa"), href: hrefAula(a.id) }, miolo)
          : el("div", { class: "card-aula bloqueada", "aria-disabled": "true" }, miolo);
        lista.appendChild(el("li", null, [card]));
      });
      if (!achou) lista.appendChild(el("li", { class: "vazio", text: "Nenhuma aula encontrada." }));
    }
    busca.addEventListener("input", function () { desenhar(busca.value); });
    desenhar("");

    /* Descrição do curso (campo do painel), só se preenchida. */
    var descricao = (curso.descricao || "").trim();
    var intro = descricao ? el("p", { class: "descricao-curso", text: descricao }) : null;

    app.textContent = "";
    [intro, busca, progresso, barra, lista].forEach(function (n) { if (n) app.appendChild(n); });
  }

  function montarPlayer(video, tituloAula) {
    var caixa = el("div", { class: "player" });
    var id = video && video.provedor === "youtube" ? String(video.id || "") : "";
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
      caixa.appendChild(el("div", { class: "player-aviso" }, [
        el("div", { text: "Vídeo indisponível." })
      ]));
      return caixa;
    }
    var capa = el("button", { class: "player-capa", type: "button", "aria-label": "Reproduzir vídeo: " + tituloAula }, [
      el("span", null, [el("span", { class: "play", text: "▶" }), "Toque para assistir"])
    ]);
    capa.addEventListener("click", function () {
      var iframe = el("iframe", {
        src: "https://www.youtube-nocookie.com/embed/" + id + "?rel=0&modestbranding=1&playsinline=1&autoplay=1",
        title: tituloAula,
        allow: "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen",
        allowfullscreen: "",
        referrerpolicy: "strict-origin-when-cross-origin"
      });
      caixa.textContent = "";
      caixa.appendChild(iframe);
    });
    caixa.appendChild(capa);
    return caixa;
  }

  function itemLink(titulo, href, rotulo) {
    return el("a", { class: "item-link", href: href, target: "_blank", rel: "noopener noreferrer" }, [
      el("span", { text: titulo }),
      el("small", { text: rotulo })
    ]);
  }

  /* Quiz: correção só no aparelho. Nada é gravado nem enviado. */
  function montarQuiz(c, idBloco) {
    var opcoes = Array.isArray(c.opcoes) ? c.opcoes.filter(function (o) { return typeof o === "string"; }) : [];
    var correta = Number(c.correta);
    if (typeof c.pergunta !== "string" || opcoes.length < 2 || !(correta >= 0 && correta < opcoes.length)) return null;

    var nome = "quiz-" + idBloco;
    var form = el("form", { class: "quiz" });
    var fs = el("fieldset", null, [el("legend", { text: c.pergunta })]);
    var rotulos = opcoes.map(function (o, i) {
      var r = el("label", { class: "opcao" }, [
        el("input", { type: "radio", name: nome, value: String(i) }),
        el("span", { text: o })
      ]);
      fs.appendChild(r);
      return r;
    });
    var retorno = el("div", { class: "quiz-retorno", "aria-live": "polite" });
    var btn = el("button", { class: "btn primario", type: "submit", text: "Conferir" });
    var conferido = false;

    function limpar() {
      conferido = false;
      retorno.textContent = "";
      retorno.className = "quiz-retorno";
      rotulos.forEach(function (r) {
        r.classList.remove("certa", "errada");
        r.firstChild.disabled = false;
        r.firstChild.checked = false;
      });
      btn.textContent = "Conferir";
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (conferido) { limpar(); rotulos[0].firstChild.focus(); return; }
      var sel = form.querySelector("input:checked");
      if (!sel) { retorno.textContent = "Escolha uma opção."; return; }
      var escolhida = Number(sel.value);
      var acertou = escolhida === correta;
      conferido = true;
      rotulos.forEach(function (r, i) {
        r.firstChild.disabled = true;
        if (i === correta) r.classList.add("certa");
        else if (i === escolhida) r.classList.add("errada");
      });
      retorno.textContent = "";
      retorno.className = "quiz-retorno " + (acertou ? "ok" : "erro");
      retorno.appendChild(el("strong", { text: acertou ? "Certo!" : "Não foi dessa vez." }));
      if (!acertou) retorno.appendChild(el("p", { text: "Resposta certa: " + opcoes[correta] }));
      if (typeof c.explicacao === "string" && c.explicacao.trim()) {
        retorno.appendChild(el("p", { class: "explicacao", text: c.explicacao }));
      }
      btn.textContent = "Tentar de novo";
    });

    form.appendChild(fs);
    form.appendChild(btn);
    form.appendChild(retorno);
    return form;
  }

  function montarBloco(b, tituloCard) {
    var c = b.conteudo || {};
    var corpo = null;
    if (b.tipo === "texto" && typeof c.texto === "string") {
      corpo = el("p", { class: "texto-bloco" }, textoComLinks(c.texto));
    } else if (b.tipo === "link") {
      var href = urlSegura(c.url);
      if (href) corpo = itemLink(c.rotulo || c.url, href, "Link ↗");
    } else if (b.tipo === "video") {
      corpo = montarPlayer({ provedor: "youtube", id: c.youtube_id }, b.subtitulo || tituloCard);
    } else if (b.tipo === "arquivo" && typeof c.storage_path === "string") {
      corpo = itemLink(c.nome || "Arquivo", urlMaterial(c.storage_path, c.nome || "arquivo"), tamanhoLegivel(c.tamanho_bytes));
    } else if (b.tipo === "quiz") {
      corpo = montarQuiz(c, b.id);
    }
    if (!corpo) return null;
    return el("section", { class: "bloco bloco-" + b.tipo }, [
      b.subtitulo ? el("h3", { text: b.subtitulo }) : null,
      corpo
    ]);
  }

  function acharAula(id) {
    var idx = -1;
    dados.aulas.forEach(function (a, i) { if (a.id === id) idx = i; });
    return idx;
  }

  function telaAula(id) {
    var idx = acharAula(id);
    if (idx === -1 || !podeAbrir(dados.aulas[idx])) { location.hash = "#/"; return; }
    var aula = dados.aulas[idx];
    cabecalho(aula.titulo, dados.curso.titulo, "#/");

    var meta = el("p", { class: "meta" });
    var btnVista = el("button", { class: "btn", type: "button" });
    function atualizarBotao() {
      var v = lerVistas()[aula.id];
      meta.textContent = (aula.duracao || "") + (v ? (aula.duracao ? " · " : "") + "assistida" : "");
      btnVista.textContent = v ? "✓ Aula assistida" : "Marcar como assistida";
      btnVista.className = "btn" + (v ? " feito" : " primario");
    }
    btnVista.addEventListener("click", function () {
      var v = lerVistas();
      if (v[aula.id]) delete v[aula.id]; else v[aula.id] = true;
      gravarVistas(v);
      atualizarBotao();
    });
    atualizarBotao();

    var cards = el("ul", { class: "lista lista-cards" });
    aula.cards.forEach(function (c) {
      cards.appendChild(el("li", null, [
        el("a", { class: "card-conteudo", href: hrefCard(aula.id, c.id) }, [
          el("div", null, [el("h3", { text: c.titulo }), c.descricao ? el("p", { text: c.descricao }) : null]),
          el("span", { class: "seta", "aria-hidden": "true", text: "›" })
        ])
      ]));
    });
    if (!aula.cards.length) cards.appendChild(el("li", { class: "vazio", text: "Conteúdo em preparação." }));

    var abriveis = dados.aulas.filter(podeAbrir);
    var pos = abriveis.indexOf(aula);
    var nav = el("div", { class: "nav-aulas" });
    if (pos > 0) nav.appendChild(el("a", { class: "btn", href: hrefAula(abriveis[pos - 1].id), text: "← Aula anterior" }));
    if (pos < abriveis.length - 1) nav.appendChild(el("a", { class: "btn", href: hrefAula(abriveis[pos + 1].id), text: "Próxima aula →" }));

    app.textContent = "";
    [
      el("div", { class: "detalhe" }, [
        el("h2", { text: aula.titulo }),
        aula.disponivel ? null : el("p", { class: "chip chip-estado", text: "Prévia: aula indisponível para alunos" }),
        meta,
        aula.descricao ? el("p", { text: aula.descricao }) : null,
        btnVista
      ]),
      el("section", { class: "secao" }, [el("h3", { text: "Conteúdo" }), cards]),
      nav
    ].forEach(function (n) { if (n) app.appendChild(n); });
  }

  function telaCard(idAula, idCard) {
    var idx = acharAula(idAula);
    if (idx === -1 || !podeAbrir(dados.aulas[idx])) { location.hash = "#/"; return; }
    var aula = dados.aulas[idx];
    var pos = -1;
    aula.cards.forEach(function (c, i) { if (c.id === idCard) pos = i; });
    if (pos === -1) { location.hash = hrefAula(aula.id); return; }
    var card = aula.cards[pos];
    cabecalho(card.titulo, aula.titulo, hrefAula(aula.id));

    app.textContent = "";
    app.appendChild(el("div", { class: "detalhe" }, [
      el("h2", { text: card.titulo }),
      card.descricao ? el("p", { class: "meta", text: card.descricao }) : null
    ]));
    var algum = false;
    card.blocos.forEach(function (b) {
      var n = montarBloco(b, card.titulo);
      if (n) { app.appendChild(n); algum = true; }
    });
    if (!algum) app.appendChild(el("p", { class: "vazio", text: "Conteúdo em preparação." }));

    var nav = el("div", { class: "nav-aulas" });
    if (pos > 0) nav.appendChild(el("a", { class: "btn", href: hrefCard(aula.id, aula.cards[pos - 1].id), text: "← Anterior" }));
    nav.appendChild(el("a", { class: "btn", href: hrefAula(aula.id), text: "Voltar à aula" }));
    if (pos < aula.cards.length - 1) nav.appendChild(el("a", { class: "btn", href: hrefCard(aula.id, aula.cards[pos + 1].id), text: "Próximo →" }));
    app.appendChild(nav);
  }

  function telaErro(msg) {
    cabecalho(NOME_APP, "", null);
    app.textContent = "";
    app.appendChild(el("p", { class: "vazio", text: msg }));
  }

  function telaIndisponivel(curso) {
    cabecalho((curso && curso.titulo) || NOME_APP, (curso && curso.professor) || "", null);
    app.textContent = "";
    app.appendChild(el("p", { class: "indisponivel", role: "status", text: MSG_INDISPONIVEL }));
  }

  function mostrarFaixa(modo, admin) {
    faixa.hidden = true;
    faixa.className = "faixa";
    if (!admin) return;
    if (modo === "teste") {
      faixa.textContent = "Modo teste: só o administrador vê o conteúdo. Alunos veem “" + MSG_INDISPONIVEL + "”.";
      faixa.className = "faixa teste";
      faixa.hidden = false;
    } else if (modo === "disponivel" && dados && dados.aulas.some(function (a) { return !a.disponivel; })) {
      faixa.textContent = "Você está como administrador: aulas indisponíveis aparecem como prévia.";
      faixa.hidden = false;
    }
  }

  /* ---------- rotas ---------- */

  function rotear() {
    if (!dados) return;
    var m = /^#\/aula\/([^/]+)(?:\/card\/([^/]+))?$/.exec(location.hash);
    var idAula = null, idCard = null;
    if (m) {
      try {
        idAula = decodeURIComponent(m[1]);
        idCard = m[2] ? decodeURIComponent(m[2]) : null;
      } catch (e) { location.hash = "#/"; return; }
    }
    if (idCard !== null) telaCard(idAula, idCard);
    else if (idAula !== null) telaAula(idAula);
    else telaLista();
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  }

  btnVoltar.addEventListener("click", function () { location.hash = destinoVoltar; });
  window.addEventListener("hashchange", rotear);

  /* ---------- sessão do administrador (mesma origem do painel) ---------- */

  /* O painel (supabase-js) guarda a sessão em "sb-<ref>-auth-token". Só lemos o token de acesso. */
  function tokenAdmin() {
    try {
      var ref = new URL(CFG.supabaseUrl).hostname.split(".")[0];
      var s = JSON.parse(localStorage.getItem("sb-" + ref + "-auth-token"));
      if (s && typeof s.access_token === "string" && (!s.expires_at || s.expires_at * 1000 > Date.now() + 30000)) {
        return s.access_token;
      }
    } catch (e) { /* sem sessão */ }
    return null;
  }

  /* ---------- dados (Supabase REST) ---------- */

  function cabecalhos(token) {
    var h = { apikey: CFG.supabaseKey, Accept: "application/json" };
    if (token) h.Authorization = "Bearer " + token;
    return h;
  }

  function api(caminho, token) {
    return fetch(REST + caminho, { headers: cabecalhos(token), cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); });
  }

  function ehAdmin(token) {
    if (!token) return Promise.resolve(false);
    var h = cabecalhos(token);
    h["Content-Type"] = "application/json";
    return fetch(REST + "rpc/is_admin", { method: "POST", headers: h, body: "{}", cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : false; })
      .then(function (v) { return v === true; })
      .catch(function () { return false; });
  }

  function tamanhoLegivel(b) {
    if (!b) return "Arquivo";
    var mb = b / 1048576;
    return mb >= 1 ? mb.toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  }

  function urlMaterial(caminho, titulo) {
    var nome = String(caminho).split("/").pop().replace(/^[0-9a-f-]{36}-/i, "");
    return STORAGE_PUBLICO + caminho.split("/").map(encodeURIComponent).join("/") +
      "?download=" + encodeURIComponent(nome || titulo);
  }

  function normalizar(curso, aulas, admin) {
    return {
      curso: curso,
      admin: admin,
      aulas: aulas.map(function (a) {
        return {
          id: a.id,
          titulo: a.titulo,
          descricao: a.descricao || "",
          duracao: a.duracao || "",
          disponivel: a.disponivel !== false,
          cards: (a.cards || []).slice().sort(porOrdem).map(function (c) {
            return {
              id: c.id,
              titulo: c.titulo,
              descricao: c.descricao || "",
              blocos: (c.blocos || []).slice().sort(porOrdem)
            };
          })
        };
      })
    };
  }

  /* App fora do ar para o público: apaga as aulas guardadas para uso offline. */
  function limparAulasEmCache() {
    if (!("caches" in window)) return;
    caches.keys().then(function (nomes) {
      nomes.filter(function (n) { return n.indexOf("aulas-dados-") === 0; }).forEach(function (n) {
        caches.open(n).then(function (c) {
          c.keys().then(function (reqs) {
            reqs.forEach(function (r) { if (r.url.indexOf("/rest/v1/aulas") !== -1) c.delete(r); });
          });
        });
      });
    }).catch(function () { /* ignora */ });
  }

  var CONSULTA_AULAS = "aulas?select=id,titulo,descricao,duracao,disponivel,ordem," +
    "cards(id,titulo,descricao,ordem,blocos(id,tipo,subtitulo,conteudo,ordem))" +
    "&order=ordem.asc,created_at.asc";

  function carregar() {
    if (!/^https?:\/\//.test(CFG.supabaseUrl || "")) {
      telaErro("App ainda não configurado.");
      return;
    }
    var token = tokenAdmin();
    Promise.all([
      api("config?select=modo,titulo,professor,descricao&id=eq.1"),
      ehAdmin(token)
    ])
      .then(function (r) {
        var curso = r[0][0];
        var admin = r[1];
        var modo = curso ? curso.modo : "indisponivel";
        if (modo !== "disponivel") limparAulasEmCache();
        var ver = modo === "disponivel" || (modo === "teste" && admin);
        if (!ver) {
          dados = null;
          mostrarFaixa(modo, false);
          telaIndisponivel(curso);
          return;
        }
        /* Com token, a requisição não entra no cache offline (ver sw.js). */
        return api(CONSULTA_AULAS, admin ? token : null).then(function (aulas) {
          dados = normalizar(curso, aulas, admin);
          mostrarFaixa(modo, admin);
          rotear();
        });
      })
      .catch(function () { telaErro("Não foi possível carregar as aulas. Verifique a conexão e tente de novo."); });
  }
  carregar();

  /* ---------- instalação ---------- */

  var btnInstalar = document.getElementById("btn-instalar");
  var promptInstalacao = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    promptInstalacao = e;
    btnInstalar.hidden = false;
  });
  btnInstalar.addEventListener("click", function () {
    if (!promptInstalacao) return;
    promptInstalacao.prompt();
    promptInstalacao.userChoice.finally(function () {
      promptInstalacao = null;
      btnInstalar.hidden = true;
    });
  });
  window.addEventListener("appinstalled", function () { btnInstalar.hidden = true; });

  var avisoIos = document.getElementById("aviso-ios");
  var ehIos = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var jaInstalado = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  var avisoFechado = false;
  try { avisoFechado = localStorage.getItem("aulas.avisoIos") === "1"; } catch (e) { /* ignora */ }
  if (ehIos && !jaInstalado && !avisoFechado) avisoIos.hidden = false;
  document.getElementById("fechar-aviso-ios").addEventListener("click", function () {
    avisoIos.hidden = true;
    try { localStorage.setItem("aulas.avisoIos", "1"); } catch (e) { /* ignora */ }
  });

  /* ---------- rede e service worker ---------- */

  var toast = document.getElementById("status-rede");
  function atualizarRede() { toast.hidden = navigator.onLine; }
  window.addEventListener("online", atualizarRede);
  window.addEventListener("offline", atualizarRede);
  atualizarRede();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* sem offline, o app segue funcionando */ });
    });
  }
})();
