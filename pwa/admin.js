(function () {
  "use strict";

  var CFG = window.AULAS_CONFIG || {};
  var BUCKET = "materiais";
  var LIMITE_ARQUIVO = 50 * 1024 * 1024;   /* plano gratuito: 50 MB por arquivo */
  var LIMITE_TOTAL = 1024 * 1024 * 1024;   /* plano gratuito: 1 GB no total */

  var painel = document.getElementById("painel");
  var statusEl = document.getElementById("status");
  var quem = document.getElementById("quem");
  var btnSair = document.getElementById("btn-sair");

  /* Convite e recuperação chegam com o tipo no endereço; guardar antes do SDK limpar. */
  var tipoLink = (/[#&?]type=(invite|recovery)/.exec(location.hash + location.search) || [])[1] || null;

  if (!window.supabase || !/^https?:\/\//.test(CFG.supabaseUrl || "")) {
    painel.textContent = "Painel ainda não configurado (config.js).";
    return;
  }
  var sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  /* ---------- utilidades ---------- */

  function el(tag, attrs, filhos) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? "" : v);
      });
    }
    (filhos || []).forEach(function (f) {
      if (f) n.appendChild(typeof f === "string" ? document.createTextNode(f) : f);
    });
    return n;
  }

  function campo(rotulo, input) { return el("label", { class: "campo" }, [rotulo, input]); }

  var timerStatus = null;
  function avisar(msg, erro) {
    clearTimeout(timerStatus);
    statusEl.textContent = msg;
    statusEl.className = "status" + (erro ? " erro" : "");
    statusEl.hidden = false;
    if (!erro) timerStatus = setTimeout(function () { statusEl.hidden = true; }, 4000);
  }

  function falhou(e) {
    var msg = (e && (e.message || e.error_description)) || String(e);
    if (/row-level security|permission denied/i.test(msg)) msg = "Sem permissão. Entre de novo com a conta do administrador.";
    else if (/Failed to fetch|NetworkError/i.test(msg)) msg = "Sem conexão com o servidor. Tente de novo.";
    avisar("Erro: " + msg, true);
  }

  /* Lança o erro do Supabase, para usar em cadeias de promessas. */
  function ok(res) { if (res.error) throw res.error; return res.data; }

  function bytes(b) {
    if (!b) return "0 KB";
    var mb = b / 1048576;
    return mb >= 1 ? mb.toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  }

  function idYoutube(texto) {
    var s = String(texto || "").trim();
    if (!s) return "";
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    var id = null;
    try {
      var u = new URL(s);
      var h = u.hostname.replace(/^(www|m|music)\./, "");
      if (h === "youtu.be") id = u.pathname.split("/")[1];
      else if (/(^|\.)youtube(-nocookie)?\.com$/.test(h)) {
        id = u.searchParams.get("v") || (/^\/(embed|shorts|live|v)\/([^/?#]+)/.exec(u.pathname) || [])[2];
      }
    } catch (e) { /* não é URL */ }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }

  function nomeSeguro(nome) {
    var partes = String(nome).normalize("NFD").replace(/[̀-ͯ]/g, "").split(".");
    var ext = partes.length > 1 ? partes.pop().toLowerCase().replace(/[^a-z0-9]/g, "") : "";
    var base = partes.join(".").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "arquivo";
    return base + (ext ? "." + ext : "");
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function confirmar(msg) { return window.confirm(msg); }

  /* Reescreve "ordem" conforme a posição na lista (0, 1, 2...). */
  function reordenar(tabela, itens) {
    return Promise.all(itens.map(function (it, i) {
      if (it.ordem === i) return null;
      it.ordem = i;
      return sb.from(tabela).update({ ordem: i }).eq("id", it.id).then(ok);
    }));
  }

  function mover(tabela, itens, i, delta, depois) {
    var j = i + delta;
    if (j < 0 || j >= itens.length) return;
    var copia = itens.slice();
    var t = copia[i]; copia[i] = copia[j]; copia[j] = t;
    reordenar(tabela, copia).then(depois).catch(falhou);
  }

  /* ---------- login ---------- */

  function telaLogin(msg) {
    btnSair.hidden = true;
    quem.textContent = "";
    var email = el("input", { type: "email", autocomplete: "username", required: true });
    var senha = el("input", { type: "password", autocomplete: "current-password", required: true });
    var form = el("form", { class: "caixa" }, [
      el("h2", { text: "Entrar" }),
      msg ? el("p", { class: "dica", text: msg }) : null,
      campo("E-mail", email),
      campo("Senha", senha),
      el("div", { class: "acoes" }, [
        el("button", { class: "btn primario", type: "submit", text: "Entrar" }),
        el("button", {
          class: "btn", type: "button", text: "Esqueci a senha",
          onclick: function () {
            if (!email.value) { avisar("Digite seu e-mail primeiro.", true); email.focus(); return; }
            sb.auth.resetPasswordForEmail(email.value, { redirectTo: location.origin + location.pathname })
              .then(ok)
              .then(function () { avisar("Se o e-mail estiver cadastrado, chega um link para criar nova senha."); })
              .catch(falhou);
          }
        })
      ])
    ]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      sb.auth.signInWithPassword({ email: email.value.trim(), password: senha.value })
        .then(ok)
        .then(function () { senha.value = ""; iniciar(); })
        .catch(function (err) {
          if (/invalid login/i.test(err.message || "")) avisar("E-mail ou senha incorretos.", true);
          else falhou(err);
        });
    });
    painel.textContent = "";
    painel.appendChild(form);
    email.focus();
  }

  function telaNovaSenha() {
    var senha = el("input", { type: "password", autocomplete: "new-password", minlength: "8", required: true });
    var repetir = el("input", { type: "password", autocomplete: "new-password", minlength: "8", required: true });
    var form = el("form", { class: "caixa" }, [
      el("h2", { text: "Criar sua senha" }),
      el("p", { class: "dica", text: "Use pelo menos 8 caracteres. Guarde num gerenciador de senhas." }),
      campo("Nova senha", senha),
      campo("Repita a senha", repetir),
      el("button", { class: "btn primario", type: "submit", text: "Salvar senha" })
    ]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (senha.value !== repetir.value) { avisar("As senhas não conferem.", true); return; }
      sb.auth.updateUser({ password: senha.value })
        .then(ok)
        .then(function () {
          tipoLink = null;
          history.replaceState(null, "", location.pathname);
          avisar("Senha salva.");
          iniciar();
        })
        .catch(falhou);
    });
    painel.textContent = "";
    painel.appendChild(form);
    senha.focus();
  }

  btnSair.addEventListener("click", function () {
    sb.auth.signOut().finally(function () { telaLogin(); });
  });

  /* ---------- painel ---------- */

  var estado = { config: null, aulas: [], usoTotal: 0 };

  var MODOS = [
    { valor: "disponivel", rotulo: "Disponível", explica: "Alunos veem as aulas marcadas como disponíveis." },
    { valor: "indisponivel", rotulo: "Indisponível", explica: "Todos veem “Curso ainda não disponível”." },
    { valor: "teste", rotulo: "Teste", explica: "Alunos veem “Curso ainda não disponível”. Você, logado aqui, vê o app inteiro com a faixa “Modo teste”." }
  ];

  var TIPOS = {
    texto: "Texto",
    link: "Link",
    video: "Vídeo",
    arquivo: "Arquivo",
    quiz: "Quiz"
  };

  function porOrdem(x, y) { return (x.ordem || 0) - (y.ordem || 0); }

  function carregarTudo() {
    return Promise.all([
      sb.from("config").select("*").eq("id", 1).single().then(ok),
      sb.from("aulas").select("*, recursos(storage_path, tamanho_bytes), cards(*, blocos(*))")
        .order("ordem").order("created_at").then(ok)
    ]).then(function (r) {
      estado.config = r[0];
      var arquivos = {};
      estado.aulas = r[1].map(function (a) {
        (a.recursos || []).forEach(function (rc) { if (rc.storage_path) arquivos[rc.storage_path] = rc.tamanho_bytes || 0; });
        a.cards = (a.cards || []).sort(porOrdem);
        a.cards.forEach(function (c) {
          c.blocos = (c.blocos || []).sort(porOrdem);
          c.blocos.forEach(function (b) {
            if (b.tipo === "arquivo" && b.conteudo && b.conteudo.storage_path) {
              arquivos[b.conteudo.storage_path] = b.conteudo.tamanho_bytes || 0;
            }
          });
        });
        return a;
      });
      estado.usoTotal = Object.keys(arquivos).reduce(function (s, k) { return s + arquivos[k]; }, 0);
    });
  }

  function acharAula(id) { return estado.aulas.filter(function (x) { return x.id === id; })[0] || null; }

  function caminhosDaAula(a) {
    var lista = [];
    a.cards.forEach(function (c) { lista = lista.concat(caminhosDoCard(c)); });
    (a.recursos || []).forEach(function (r) { if (r.storage_path) lista.push(r.storage_path); });
    return lista.filter(function (p, i) { return lista.indexOf(p) === i; });
  }

  function caminhosDoCard(c) {
    return c.blocos.filter(function (b) { return b.tipo === "arquivo" && b.conteudo && b.conteudo.storage_path; })
      .map(function (b) { return b.conteudo.storage_path; });
  }

  /* Arquivo só sai do Storage se nenhum outro bloco usa o mesmo caminho. */
  function caminhoEmUsoForaDe(caminho, idsIgnorar) {
    return estado.aulas.some(function (a) {
      return a.cards.some(function (c) {
        return c.blocos.some(function (b) {
          return idsIgnorar.indexOf(b.id) === -1 && b.tipo === "arquivo" && b.conteudo && b.conteudo.storage_path === caminho;
        });
      });
    });
  }

  function telaPainel() {
    return carregarTudo().then(function () {
      painel.textContent = "";
      painel.appendChild(caixaCurso());
      painel.appendChild(caixaAulas());
    });
  }

  function caixaCurso() {
    var c = estado.config;
    var nome = "modo-" + uuid();
    var opcoes = MODOS.map(function (m) {
      var radio = el("input", { type: "radio", name: nome, value: m.valor });
      radio.checked = c.modo === m.valor;
      return el("label", { class: "modo" }, [radio, el("span", null, [el("strong", { text: m.rotulo }), el("small", { text: m.explica })])]);
    });
    var grupo = el("fieldset", { class: "modos" }, [el("legend", { text: "Modo do app" })].concat(opcoes));
    grupo.addEventListener("change", function (e) {
      var novo = e.target.value;
      var anterior = c.modo;
      grupo.disabled = true;
      sb.from("config").update({ modo: novo }).eq("id", 1).select().single().then(ok)
        .then(function (linha) {
          c.modo = linha.modo;
          var m = MODOS.filter(function (x) { return x.valor === linha.modo; })[0];
          avisar("Modo: " + m.rotulo + ".");
        })
        .catch(function (err) {
          opcoes.forEach(function (o) { o.firstChild.checked = o.firstChild.value === anterior; });
          falhou(err);
        })
        .finally(function () { grupo.disabled = false; });
    });

    var titulo = el("input", { type: "text", maxlength: "120", required: true, value: c.titulo });
    var professor = el("input", { type: "text", maxlength: "120", value: c.professor });
    var descricao = el("textarea", { maxlength: "2000" });
    descricao.value = c.descricao;

    var form = el("form", null, [
      campo("Nome do curso", titulo),
      campo("Professor", professor),
      campo("Descrição", descricao),
      el("button", { class: "btn", type: "submit", text: "Salvar dados do curso" })
    ]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      sb.from("config").update({ titulo: titulo.value.trim(), professor: professor.value.trim(), descricao: descricao.value.trim() })
        .eq("id", 1).then(ok)
        .then(function () { avisar("Dados do curso salvos."); })
        .catch(falhou);
    });

    return el("section", { class: "caixa" }, [
      el("h2", { text: "Curso" }),
      grupo,
      el("p", { class: "dica", text: "Para conferir, use “Ver app como aluno” no topo, neste mesmo navegador, com o painel logado." }),
      el("h3", { text: "Dados" }),
      form
    ]);
  }

  function chaveDisponivel(a, depois) {
    var chave = el("input", { type: "checkbox", role: "switch", "aria-label": "Aula disponível: " + a.titulo });
    chave.checked = a.disponivel;
    chave.addEventListener("change", function () {
      var novo = chave.checked;
      chave.disabled = true;
      sb.from("aulas").update({ disponivel: novo }).eq("id", a.id).select().single().then(ok)
        .then(function (linha) {
          a.disponivel = linha.disponivel;
          avisar("“" + a.titulo + "” agora está " + (novo ? "disponível." : "indisponível."));
          if (depois) depois();
        })
        .catch(function (e) { chave.checked = !novo; falhou(e); })
        .finally(function () { chave.disabled = false; });
    });
    return chave;
  }

  function chipAula(a) {
    return el("span", { class: "chip-aula" + (a.disponivel ? " on" : ""), text: a.disponivel ? "Disponível" : "Indisponível" });
  }

  function caixaAulas() {
    var lista = el("ul", { class: "linhas" });
    estado.aulas.forEach(function (a, i) {
      var chip = chipAula(a);
      lista.appendChild(el("li", { class: "linha" }, [
        el("div", { class: "texto" }, [
          (i + 1) + ". " + a.titulo,
          el("small", null, [chip, " · " + a.cards.length + (a.cards.length === 1 ? " card" : " cards")])
        ]),
        chaveDisponivel(a, function () {
          chip.textContent = a.disponivel ? "Disponível" : "Indisponível";
          chip.className = "chip-aula" + (a.disponivel ? " on" : "");
        }),
        el("button", { class: "btn mini", type: "button", "aria-label": "Subir " + a.titulo, text: "↑", disabled: i === 0,
          onclick: function () { mover("aulas", estado.aulas, i, -1, telaPainel); } }),
        el("button", { class: "btn mini", type: "button", "aria-label": "Descer " + a.titulo, text: "↓", disabled: i === estado.aulas.length - 1,
          onclick: function () { mover("aulas", estado.aulas, i, 1, telaPainel); } }),
        el("button", { class: "btn mini", type: "button", text: "Editar", onclick: function () { telaAula(a.id); } })
      ]));
    });
    if (!estado.aulas.length) lista.appendChild(el("li", { class: "vazio", text: "Nenhuma aula ainda." }));

    return el("section", { class: "caixa" }, [
      el("h2", { text: "Aulas" }),
      el("p", { class: "dica", text: "A chave de cada aula define se os alunos podem abrir. Aula indisponível aparece como “Em breve”." }),
      lista,
      el("div", { class: "acoes" }, [
        el("button", { class: "btn primario", type: "button", text: "+ Nova aula", onclick: function () { telaAula(null); } })
      ]),
      el("p", { class: "uso", text: "Arquivos enviados: " + bytes(estado.usoTotal) + " de 1 GB (plano gratuito)." })
    ]);
  }

  /* ---------- editar aula ---------- */

  function telaAula(id) {
    var a = id ? acharAula(id) : null;
    if (id && !a) { telaPainel().catch(falhou); return; }

    var titulo = el("input", { type: "text", maxlength: "120", required: true, value: a ? a.titulo : "" });
    var descricao = el("textarea", { maxlength: "2000" });
    descricao.value = a ? a.descricao : "";
    var duracao = el("input", { type: "text", maxlength: "30", placeholder: "ex.: 15 min", value: a ? a.duracao : "" });
    var disponivel = el("input", { type: "checkbox", role: "switch", "aria-label": "Aula disponível para os alunos" });
    disponivel.checked = a ? a.disponivel : false;

    var form = el("form", null, [
      campo("Título", titulo),
      campo("Descrição", descricao),
      campo("Duração", duracao),
      el("label", { class: "chave" }, [el("span", null, ["Aula disponível", el("br"),
        el("span", { class: "estado", text: "Desligada: alunos veem a aula como “Em breve”." })]), disponivel]),
      el("div", { class: "acoes" }, [
        el("button", { class: "btn primario", type: "submit", text: a ? "Salvar aula" : "Criar aula" }),
        el("button", { class: "btn", type: "button", text: "Voltar", onclick: function () { telaPainel().catch(falhou); } }),
        a ? el("button", { class: "btn perigo", type: "button", text: "Excluir aula", onclick: function () { excluirAula(a); } }) : null
      ])
    ]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var dados = { titulo: titulo.value.trim(), descricao: descricao.value.trim(), duracao: duracao.value.trim(), disponivel: disponivel.checked };
      var q = a
        ? sb.from("aulas").update(dados).eq("id", a.id).select().single()
        : sb.from("aulas").insert(Object.assign({ ordem: estado.aulas.length }, dados)).select().single();
      q.then(ok)
        .then(function (linha) { avisar(a ? "Aula salva." : "Aula criada. Agora adicione os cards."); return recarregarAula(linha.id); })
        .catch(falhou);
    });

    painel.textContent = "";
    painel.appendChild(el("section", { class: "caixa" }, [el("h2", { text: a ? "Editar aula" : "Nova aula" }), form]));
    if (a) painel.appendChild(caixaCards(a));
    window.scrollTo(0, 0);
    titulo.focus();
  }

  function removerArquivos(caminhos) {
    return caminhos.length ? sb.storage.from(BUCKET).remove(caminhos).then(ok) : Promise.resolve();
  }

  function excluirAula(a) {
    if (!confirmar("Excluir a aula “" + a.titulo + "” com todos os cards, blocos e arquivos? Não dá para desfazer.")) return;
    removerArquivos(caminhosDaAula(a))
      .then(function () { return sb.from("aulas").delete().eq("id", a.id).then(ok); })
      .then(function () { avisar("Aula excluída."); return telaPainel(); })
      .catch(falhou);
  }

  function recarregarAula(id) {
    return carregarTudo().then(function () { telaAula(id); });
  }

  function caixaCards(a) {
    var lista = el("ul", { class: "linhas" });
    a.cards.forEach(function (c, i) {
      lista.appendChild(el("li", { class: "linha" }, [
        el("div", { class: "texto" }, [
          c.titulo,
          el("small", { text: (c.descricao ? c.descricao + " · " : "") + c.blocos.length + (c.blocos.length === 1 ? " bloco" : " blocos") })
        ]),
        el("button", { class: "btn mini", type: "button", "aria-label": "Subir " + c.titulo, text: "↑", disabled: i === 0,
          onclick: function () { mover("cards", a.cards, i, -1, function () { return recarregarAula(a.id); }); } }),
        el("button", { class: "btn mini", type: "button", "aria-label": "Descer " + c.titulo, text: "↓", disabled: i === a.cards.length - 1,
          onclick: function () { mover("cards", a.cards, i, 1, function () { return recarregarAula(a.id); }); } }),
        el("button", { class: "btn mini", type: "button", text: "Editar", onclick: function () { telaCard(a.id, c.id); } }),
        el("button", { class: "btn mini perigo", type: "button", text: "Excluir", onclick: function () { excluirCard(a, c); } })
      ]));
    });
    if (!a.cards.length) lista.appendChild(el("li", { class: "vazio", text: "Nenhum card ainda." }));

    var titulo = el("input", { type: "text", maxlength: "120", required: true, placeholder: "ex.: Revisão" });
    var descricao = el("input", { type: "text", maxlength: "300", placeholder: "Aparece abaixo do título na página da aula" });
    var form = el("form", null, [
      campo("Título do card", titulo),
      campo("Descrição breve", descricao),
      el("button", { class: "btn primario", type: "submit", text: "+ Novo card" })
    ]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      sb.from("cards").insert({ aula_id: a.id, titulo: titulo.value.trim(), descricao: descricao.value.trim(), ordem: a.cards.length })
        .select().single().then(ok)
        .then(function (c) { avisar("Card criado. Agora adicione os blocos."); return recarregarCard(a.id, c.id); })
        .catch(falhou);
    });

    return el("section", { class: "caixa" }, [
      el("h2", { text: "Cards da aula" }),
      el("p", { class: "dica", text: "Os alunos veem os cards na página da aula, nesta ordem, com título e descrição." }),
      lista,
      el("h3", { text: "Novo card" }),
      form
    ]);
  }

  function excluirCard(a, c) {
    if (!confirmar("Excluir o card “" + c.titulo + "” com todos os blocos? Não dá para desfazer.")) return;
    var ids = c.blocos.map(function (b) { return b.id; });
    var caminhos = caminhosDoCard(c).filter(function (p) { return !caminhoEmUsoForaDe(p, ids); });
    removerArquivos(caminhos)
      .then(function () { return sb.from("cards").delete().eq("id", c.id).then(ok); })
      .then(function () { avisar("Card excluído."); return recarregarAula(a.id); })
      .catch(falhou);
  }

  /* ---------- editar card e blocos ---------- */

  function recarregarCard(idAula, idCard) {
    return carregarTudo().then(function () { telaCard(idAula, idCard); });
  }

  function telaCard(idAula, idCard) {
    var a = acharAula(idAula);
    var c = a && a.cards.filter(function (x) { return x.id === idCard; })[0];
    if (!c) { if (a) telaAula(a.id); else telaPainel().catch(falhou); return; }

    var titulo = el("input", { type: "text", maxlength: "120", required: true, value: c.titulo });
    var descricao = el("input", { type: "text", maxlength: "300", value: c.descricao });
    var form = el("form", null, [
      campo("Título do card", titulo),
      campo("Descrição breve", descricao),
      el("div", { class: "acoes" }, [
        el("button", { class: "btn primario", type: "submit", text: "Salvar card" }),
        el("button", { class: "btn", type: "button", text: "Voltar à aula", onclick: function () { telaAula(a.id); } })
      ])
    ]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      sb.from("cards").update({ titulo: titulo.value.trim(), descricao: descricao.value.trim() }).eq("id", c.id).then(ok)
        .then(function () { avisar("Card salvo."); return recarregarCard(a.id, c.id); })
        .catch(falhou);
    });

    var lista = el("div", { class: "blocos" });
    c.blocos.forEach(function (b, i) { lista.appendChild(editorBloco(a, c, b, b.tipo, i)); });
    if (!c.blocos.length) lista.appendChild(el("p", { class: "vazio", text: "Nenhum bloco ainda. Use os botões abaixo." }));

    var botoes = el("div", { class: "acoes" }, Object.keys(TIPOS).map(function (t) {
      return el("button", { class: "btn", type: "button", text: "+ " + TIPOS[t], onclick: function () {
        var vazio = lista.querySelector(".vazio");
        if (vazio) vazio.remove();
        var ed = editorBloco(a, c, null, t, c.blocos.length);
        lista.appendChild(ed);
        var foco = ed.querySelector("input, textarea");
        if (foco) foco.focus();
      } });
    }));

    painel.textContent = "";
    painel.appendChild(el("p", { class: "trilha", text: a.titulo + " › " + c.titulo }));
    painel.appendChild(el("section", { class: "caixa" }, [el("h2", { text: "Editar card" }), form]));
    painel.appendChild(el("section", { class: "caixa" }, [
      el("h2", { text: "Blocos" }),
      el("p", { class: "dica", text: "Cada bloco tem um subtítulo opcional. Use ↑ ↓ para mudar a ordem." }),
      lista,
      el("h3", { text: "Adicionar bloco" }),
      botoes
    ]));
    window.scrollTo(0, 0);
  }

  /* Monta o formulário de um bloco (novo quando b é null). */
  function editorBloco(a, c, b, tipo, i) {
    var cont = (b && b.conteudo) || {};
    var subtitulo = el("input", { type: "text", maxlength: "200", value: b ? b.subtitulo : "", placeholder: "Opcional" });
    var campos = [campo("Subtítulo", subtitulo)];
    var lerConteudo;       /* devolve o objeto conteudo ou lança Error com a mensagem */
    var arquivoInput = null;

    if (tipo === "texto") {
      var texto = el("textarea", { maxlength: "10000", required: true, class: "alto" });
      texto.value = cont.texto || "";
      campos.push(campo("Texto", texto));
      campos.push(el("p", { class: "dica", text: "Texto simples. Quebras de linha são mantidas." }));
      lerConteudo = function () {
        if (!texto.value.trim()) throw new Error("Escreva o texto.");
        return { texto: texto.value.trim() };
      };
    } else if (tipo === "link") {
      var rotulo = el("input", { type: "text", maxlength: "200", value: cont.rotulo || "", placeholder: "ex.: Simulador PhET" });
      var url = el("input", { type: "url", maxlength: "2000", required: true, value: cont.url || "", placeholder: "https://..." });
      campos.push(campo("Texto do link", rotulo), campo("Endereço", url));
      lerConteudo = function () {
        var u = url.value.trim();
        if (!/^https?:\/\/\S/i.test(u)) throw new Error("O endereço precisa começar com https://");
        var r = { url: u };
        if (rotulo.value.trim()) r.rotulo = rotulo.value.trim();
        return r;
      };
    } else if (tipo === "video") {
      var video = el("input", { type: "text", required: true, placeholder: "https://youtu.be/... ou ID",
        value: cont.youtube_id ? "https://youtu.be/" + cont.youtube_id : "" });
      var previa = el("div", { class: "previa", "aria-live": "polite" });
      var atualizar = function () {
        previa.textContent = "";
        var v = idYoutube(video.value);
        if (v === "") previa.appendChild(document.createTextNode("Cole o link do vídeo."));
        else if (v === null) previa.appendChild(document.createTextNode("Link do YouTube não reconhecido."));
        else {
          previa.appendChild(el("img", { src: "https://i.ytimg.com/vi/" + v + "/mqdefault.jpg", alt: "" }));
          previa.appendChild(document.createTextNode("ID: " + v));
        }
      };
      video.addEventListener("input", atualizar);
      atualizar();
      campos.push(campo("Vídeo do YouTube (não listado)", video), previa,
        el("p", { class: "dica", text: "No YouTube, deixe o vídeo como “Não listado” e com incorporação permitida." }));
      lerConteudo = function () {
        var v = idYoutube(video.value);
        if (!v) throw new Error("Link do YouTube não reconhecido.");
        return { youtube_id: v };
      };
    } else if (tipo === "arquivo") {
      var nome = el("input", { type: "text", maxlength: "200", required: true, value: cont.nome || "", placeholder: "ex.: Lista de exercícios" });
      campos.push(campo("Nome do arquivo para o aluno", nome));
      if (b) {
        campos.push(el("p", { class: "dica", text: "Arquivo enviado · " + bytes(cont.tamanho_bytes) + ". Para trocar, exclua este bloco e crie outro." }));
      } else {
        arquivoInput = el("input", { type: "file", accept: ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,.png,.jpg,.jpeg,.webp,.txt", required: true });
        campos.push(campo("Arquivo (até 50 MB)", arquivoInput));
      }
      lerConteudo = function () {
        if (!nome.value.trim()) throw new Error("Dê um nome ao arquivo.");
        return { storage_path: cont.storage_path, nome: nome.value.trim(), tamanho_bytes: cont.tamanho_bytes || 0 };
      };
    } else if (tipo === "quiz") {
      var pergunta = el("textarea", { maxlength: "500", required: true });
      pergunta.value = cont.pergunta || "";
      var explicacao = el("textarea", { maxlength: "1000", placeholder: "Opcional: aparece depois que o aluno confere" });
      explicacao.value = cont.explicacao || "";
      var caixaOpcoes = el("div", { class: "opcoes-editor" });
      var grupoCorreta = "correta-" + uuid();
      var linhas = [];
      var renumerar = function () {
        linhas.forEach(function (l, k) {
          l.texto.setAttribute("aria-label", "Opção " + (k + 1));
          l.texto.placeholder = "Opção " + (k + 1);
        });
        btnMais.disabled = linhas.length >= 6;
      };
      var novaOpcao = function (valor, marcada) {
        if (linhas.length >= 6) return;
        var radio = el("input", { type: "radio", name: grupoCorreta });
        radio.checked = !!marcada;
        var txt = el("input", { type: "text", maxlength: "300", value: valor || "" });
        var l = { texto: txt, radio: radio };
        var linha = el("div", { class: "opcao-editor" }, [
          el("label", { class: "marca" }, [radio, "certa"]),
          txt,
          el("button", { class: "btn mini", type: "button", "aria-label": "Remover opção", text: "✕", onclick: function () {
            if (linhas.length <= 2) { avisar("O quiz precisa de pelo menos 2 opções.", true); return; }
            linhas.splice(linhas.indexOf(l), 1);
            linha.remove();
            renumerar();
          } })
        ]);
        linhas.push(l);
        caixaOpcoes.appendChild(linha);
        renumerar();
      };
      var btnMais = el("button", { class: "btn", type: "button", text: "+ Opção", onclick: function () {
        novaOpcao("", false);
        linhas[linhas.length - 1].texto.focus();
      } });
      var iniciais = Array.isArray(cont.opcoes) && cont.opcoes.length >= 2 ? cont.opcoes : ["", ""];
      iniciais.forEach(function (o, k) { novaOpcao(o, k === cont.correta); });
      campos.push(
        campo("Pergunta", pergunta),
        el("fieldset", { class: "quiz-editor" }, [el("legend", { text: "Opções (marque a certa)" }), caixaOpcoes, btnMais]),
        campo("Explicação", explicacao)
      );
      lerConteudo = function () {
        if (!pergunta.value.trim()) throw new Error("Escreva a pergunta.");
        var opcoes = linhas.map(function (l) { return l.texto.value.trim(); });
        if (opcoes.some(function (o) { return !o; })) throw new Error("Preencha todas as opções ou remova as vazias.");
        var correta = -1;
        linhas.forEach(function (l, k) { if (l.radio.checked) correta = k; });
        if (correta === -1) throw new Error("Marque qual opção é a certa.");
        var r = { pergunta: pergunta.value.trim(), opcoes: opcoes, correta: correta };
        if (explicacao.value.trim()) r.explicacao = explicacao.value.trim();
        return r;
      };
    }

    var salvar = el("button", { class: "btn primario", type: "submit", text: b ? "Salvar bloco" : "Adicionar bloco" });
    var acoes = [salvar];
    if (b) {
      acoes.push(
        el("button", { class: "btn mini", type: "button", "aria-label": "Subir bloco", text: "↑", disabled: i === 0,
          onclick: function () { mover("blocos", c.blocos, i, -1, function () { return recarregarCard(a.id, c.id); }); } }),
        el("button", { class: "btn mini", type: "button", "aria-label": "Descer bloco", text: "↓", disabled: i === c.blocos.length - 1,
          onclick: function () { mover("blocos", c.blocos, i, 1, function () { return recarregarCard(a.id, c.id); }); } }),
        el("button", { class: "btn mini perigo", type: "button", text: "Excluir", onclick: function () { excluirBloco(a, c, b); } })
      );
    } else {
      acoes.push(el("button", { class: "btn", type: "button", text: "Cancelar", onclick: function () { form.remove(); } }));
    }

    var form = el("form", { class: "bloco-editor" + (b ? "" : " novo") }, [
      el("p", { class: "tipo-bloco", text: TIPOS[tipo] + (b ? " · bloco " + (i + 1) : " · novo") })
    ].concat(campos, [el("div", { class: "acoes" }, acoes)]));

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var conteudo;
      try { conteudo = lerConteudo(); } catch (err) { avisar(err.message, true); return; }
      var sub = subtitulo.value.trim();
      salvar.disabled = true;

      var feito;
      if (b) {
        feito = sb.from("blocos").update({ subtitulo: sub, conteudo: conteudo }).eq("id", b.id).then(ok);
      } else if (tipo === "arquivo") {
        feito = enviarArquivo(a, arquivoInput.files[0]).then(function (up) {
          conteudo.storage_path = up.caminho;
          conteudo.tamanho_bytes = up.tamanho;
          return sb.from("blocos").insert({ card_id: c.id, tipo: tipo, subtitulo: sub, conteudo: conteudo, ordem: c.blocos.length })
            .then(function (res) {
              /* não deixar arquivo órfão no Storage */
              if (res.error) return removerArquivos([up.caminho]).then(function () { throw res.error; });
            });
        });
      } else {
        feito = sb.from("blocos").insert({ card_id: c.id, tipo: tipo, subtitulo: sub, conteudo: conteudo, ordem: c.blocos.length }).then(ok);
      }
      feito
        .then(function () { avisar(b ? "Bloco salvo." : "Bloco adicionado."); return recarregarCard(a.id, c.id); })
        .catch(function (err) {
          if (/mime type|not supported/i.test(err.message || "")) avisar("Tipo de arquivo não aceito. Use PDF, Word, PowerPoint, Excel, imagem, ZIP ou TXT.", true);
          else if (/exceeded|too large|maximum allowed size/i.test(err.message || "")) avisar("Arquivo maior que o limite de 50 MB.", true);
          else falhou(err);
        })
        .finally(function () { salvar.disabled = false; });
    });
    return form;
  }

  function enviarArquivo(a, f) {
    if (!f) return Promise.reject(new Error("Escolha o arquivo."));
    if (f.size > LIMITE_ARQUIVO) return Promise.reject(new Error("Arquivo com " + bytes(f.size) + ". O limite é 50 MB."));
    if (estado.usoTotal + f.size > LIMITE_TOTAL) return Promise.reject(new Error("Espaço insuficiente: o total passaria de 1 GB. Exclua arquivos antigos."));
    var caminho = a.id + "/" + uuid() + "-" + nomeSeguro(f.name);
    return sb.storage.from(BUCKET).upload(caminho, f, { contentType: f.type || undefined, upsert: false }).then(ok)
      .then(function () { return { caminho: caminho, tamanho: f.size }; });
  }

  function excluirBloco(a, c, b) {
    if (!confirmar("Excluir este bloco (" + TIPOS[b.tipo] + ")? Não dá para desfazer.")) return;
    var caminho = b.tipo === "arquivo" && b.conteudo ? b.conteudo.storage_path : null;
    var arquivo = caminho && !caminhoEmUsoForaDe(caminho, [b.id]) ? removerArquivos([caminho]) : Promise.resolve();
    arquivo
      .then(function () { return sb.from("blocos").delete().eq("id", b.id).then(ok); })
      .then(function () { avisar("Bloco excluído."); return recarregarCard(a.id, c.id); })
      .catch(falhou);
  }

  /* ---------- início ---------- */

  function iniciar() {
    sb.auth.getSession().then(function (r) {
      var sessao = r.data && r.data.session;
      if (!sessao) { telaLogin(); return; }
      if (tipoLink) { telaNovaSenha(); return; }
      quem.textContent = sessao.user.email || "";
      btnSair.hidden = false;
      return sb.rpc("is_admin").then(ok).then(function (admin) {
        if (!admin) {
          return sb.auth.signOut().then(function () { telaLogin("Esta conta não tem acesso ao painel."); });
        }
        return telaPainel();
      });
    }).catch(falhou);
  }

  sb.auth.onAuthStateChange(function (evento) {
    if (evento === "PASSWORD_RECOVERY") { tipoLink = "recovery"; setTimeout(telaNovaSenha, 0); }
  });

  iniciar();
})();
