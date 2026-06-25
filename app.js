/* 
  Solicitações Vigilância v2
  Melhorias incluídas:
  - ID único oficial do chamado
  - Status completo
  - Painel da Vigilância
  - Controle de tempo de atendimento
  - Campos inteligentes e validações
  - Visual responsivo
  - Perfil Solicitante / Vigilância
  - Base de dados preparada para relatórios

  Não incluído:
  - Anexo de foto
  - QR Code
*/

const CONFIG = {
  APPS_SCRIPT_URL: "", // Cole aqui a URL /exec do Apps Script, se quiser salvar no Google Planilhas
  WHATSAPP_NUMERO: "", // Exemplo: "5531999999999". Deixe vazio para o usuário escolher contato no WhatsApp.
  PIN_VIGILANCIA: "1234",
  LIMITE_ATRASO_MINUTOS: 60,
  USAR_BACKEND: false // Mude para true depois de configurar o Apps Script
};

const STATUS = [
  "Aberto",
  "Recebido",
  "Em atendimento",
  "Aguardando solicitante",
  "Finalizado",
  "Cancelado"
];

const SUBTIPOS = {
  "Boletim de Ocorrência": ["Dano material", "Acidente", "Roubo/Furto", "Outros"],
  "Conferência": ["Material", "Equipamento", "Entulho", "Protótipo", "Vasilhames", "Outros"],
  "Acompanhamento": ["Acompanhamento de atividade", "Acompanhamento de terceiro", "Acesso a área", "Outros"]
};

let perfilAtual = localStorage.getItem("perfilAtual") || "";
let chamadosCache = [];
let chatState = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  bindPerfil();
  bindFormulario();
  bindConsulta();
  bindPainel();
  initBot();
  registerServiceWorker();

  if (perfilAtual) {
    aplicarPerfil(perfilAtual);
    go("inicio");
  } else {
    go("perfil");
  }

  refreshAll();
});

function bindNavigation() {
  $$("[data-go]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.go;
      if (target === "painel" && perfilAtual !== "vigilancia") {
        alert("O painel é restrito ao perfil Vigilância.");
        return;
      }
      go(target);
    });
  });

  $("#btnTrocarPerfil").addEventListener("click", () => {
    perfilAtual = "";
    localStorage.removeItem("perfilAtual");
    go("perfil");
    $("#bottomNav").classList.add("hidden");
  });
}

function go(name) {
  const map = {
    perfil: "#telaPerfil",
    inicio: "#telaInicio",
    nova: "#telaNova",
    bot: "#telaBot",
    consultar: "#telaConsultar",
    painel: "#telaPainel",
    config: "#telaConfig"
  };

  $$(".screen").forEach(s => s.classList.remove("active"));
  $(map[name] || "#telaInicio").classList.add("active");

  $$("#bottomNav button").forEach(b => b.classList.toggle("active", b.dataset.go === name));

  if (name === "painel") renderPainel();
  if (name === "inicio") renderHome();
  if (name === "bot") restartBot();
}

function bindPerfil() {
  $$(".profile-card").forEach(btn => {
    btn.addEventListener("click", () => {
      const profile = btn.dataset.profile;
      if (profile === "vigilancia") {
        $("#pinBox").classList.remove("hidden");
        $("#pinVigilancia").focus();
      } else {
        aplicarPerfil("solicitante");
        go("inicio");
      }
    });
  });

  $("#btnEntrarVigilancia").addEventListener("click", () => {
    const pin = $("#pinVigilancia").value.trim();
    if (pin !== CONFIG.PIN_VIGILANCIA) {
      alert("PIN incorreto.");
      return;
    }
    aplicarPerfil("vigilancia");
    go("inicio");
  });
}

function aplicarPerfil(profile) {
  perfilAtual = profile;
  localStorage.setItem("perfilAtual", profile);
  $("#bottomNav").classList.remove("hidden");
  $$(".admin-only").forEach(el => el.classList.toggle("hidden", profile !== "vigilancia"));
}

function bindFormulario() {
  $("#origem").addEventListener("change", updateOrigemFields);
  $("#temColuna").addEventListener("change", () => toggleRequired("#boxColuna", "coluna", $("#temColuna").value === "Sim"));
  $("#temSala").addEventListener("change", () => toggleRequired("#boxSala", "sala", $("#temSala").value === "Sim"));
  $("#tipo").addEventListener("change", updateSubtipos);
  $("#subtipo").addEventListener("change", () => toggleRequired("#boxOutro", "outroDetalhe", $("#subtipo").value === "Outros"));

  $("#formChamado").addEventListener("submit", async (e) => {
    e.preventDefault();
    const chamado = formToChamado(new FormData(e.currentTarget));
    const validacao = validarChamado(chamado);
    if (!validacao.ok) {
      alert(validacao.msg);
      return;
    }

    await salvarChamado(chamado);
    e.currentTarget.reset();
    updateOrigemFields();
    updateSubtipos();
    exibirModalChamado(chamado);
    refreshAll();
  });

  $("#modalFechar").addEventListener("click", () => $("#modalChamado").classList.add("hidden"));
}

function updateOrigemFields() {
  const origem = $("#origem").value;
  const isStellantis = origem === "Stellantis";
  const isTerceiro = origem === "Terceiro";

  $$(".field-stellantis").forEach(el => el.classList.toggle("hidden", !isStellantis));
  $$(".field-terceiro").forEach(el => el.classList.toggle("hidden", !isTerceiro));

  document.querySelector("[name='diretoria']").required = isStellantis;
  document.querySelector("[name='empresa']").required = isTerceiro;
}

function toggleRequired(boxSel, fieldName, show) {
  $(boxSel).classList.toggle("hidden", !show);
  document.querySelector(`[name='${fieldName}']`).required = show;
  if (!show) document.querySelector(`[name='${fieldName}']`).value = "";
}

function updateSubtipos() {
  const tipo = $("#tipo").value;
  const box = $("#boxSubtipo");
  const select = $("#subtipo");
  select.innerHTML = '<option value="">Selecione</option>';

  if (!tipo) {
    box.classList.add("hidden");
    select.required = false;
    toggleRequired("#boxOutro", "outroDetalhe", false);
    return;
  }

  (SUBTIPOS[tipo] || []).forEach(item => {
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = item;
    select.appendChild(opt);
  });

  box.classList.remove("hidden");
  select.required = true;
}

function formToChamado(fd) {
  const now = new Date();
  const id = gerarIdChamado();

  return {
    id,
    status: "Aberto",
    solicitante: val(fd, "solicitante"),
    contato: val(fd, "contato"),
    origem: val(fd, "origem"),
    diretoria: val(fd, "diretoria"),
    empresa: val(fd, "empresa"),
    setor: val(fd, "setor"),
    temColuna: val(fd, "temColuna"),
    coluna: val(fd, "coluna"),
    temSala: val(fd, "temSala"),
    sala: val(fd, "sala"),
    tipo: val(fd, "tipo"),
    subtipo: val(fd, "subtipo"),
    outroDetalhe: val(fd, "outroDetalhe"),
    prioridade: val(fd, "prioridade") || "Normal",
    turno: val(fd, "turno"),
    observacoes: val(fd, "observacoes"),
    dataAbertura: now.toISOString(),
    dataRecebimento: "",
    dataInicioAtendimento: "",
    dataFinalizacao: "",
    tempoTotalMinutos: "",
    responsavel: "",
    historico: [
      {
        data: now.toISOString(),
        status: "Aberto",
        descricao: "Chamado registrado pelo solicitante."
      }
    ]
  };
}

function val(fd, key) {
  return String(fd.get(key) || "").trim();
}

function validarChamado(c) {
  if (!c.solicitante) return {ok:false, msg:"Informe o solicitante."};
  if (!c.origem) return {ok:false, msg:"Selecione a origem."};
  if (c.origem === "Stellantis" && !c.diretoria) return {ok:false, msg:"Informe a diretoria."};
  if (c.origem === "Terceiro" && !c.empresa) return {ok:false, msg:"Informe a empresa terceira."};
  if (!c.setor) return {ok:false, msg:"Informe o setor ou área."};
  if (c.temColuna === "Sim" && !c.coluna) return {ok:false, msg:"Informe a coluna."};
  if (c.temSala === "Sim" && !c.sala) return {ok:false, msg:"Informe a sala."};
  if (!c.tipo) return {ok:false, msg:"Selecione o tipo de solicitação."};
  if (!c.subtipo) return {ok:false, msg:"Selecione o detalhe do tipo."};
  if (c.subtipo === "Outros" && !c.outroDetalhe) return {ok:false, msg:"Descreva o item Outros."};
  return {ok:true};
}

function gerarIdChamado() {
  const hoje = yyyymmdd(new Date());
  const chamados = getLocalChamados();
  const qtdHoje = chamados.filter(c => c.id && c.id.includes(`VIG-${hoje}-`)).length + 1;
  return `VIG-${hoje}-${String(qtdHoje).padStart(4, "0")}`;
}

function yyyymmdd(date) {
  const d = new Date(date);
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
}

async function salvarChamado(chamado) {
  const chamados = getLocalChamados();
  chamados.unshift(chamado);
  setLocalChamados(chamados);

  if (CONFIG.USAR_BACKEND && CONFIG.APPS_SCRIPT_URL) {
    try {
      await apiRequest("save", { chamado });
    } catch (err) {
      console.warn("Falha ao salvar no backend. Mantido localmente.", err);
    }
  }
}

function getLocalChamados() {
  try {
    return JSON.parse(localStorage.getItem("chamados_vigilancia") || "[]");
  } catch {
    return [];
  }
}

function setLocalChamados(list) {
  localStorage.setItem("chamados_vigilancia", JSON.stringify(list));
}

async function carregarChamados() {
  if (CONFIG.USAR_BACKEND && CONFIG.APPS_SCRIPT_URL) {
    try {
      const res = await apiRequest("list", {});
      if (res && Array.isArray(res.chamados)) {
        chamadosCache = res.chamados;
        setLocalChamados(res.chamados);
        return chamadosCache;
      }
    } catch (err) {
      console.warn("Falha ao carregar backend. Usando dados locais.", err);
    }
  }
  chamadosCache = getLocalChamados();
  return chamadosCache;
}

function apiRequest(action, data = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = `jsonp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const payload = encodeURIComponent(JSON.stringify(data));
    const url = `${CONFIG.APPS_SCRIPT_URL}?action=${encodeURIComponent(action)}&payload=${payload}&callback=${callbackName}`;
    const script = document.createElement("script");

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Tempo excedido na comunicação com o Apps Script."));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (response) => {
      cleanup();
      resolve(response);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Erro ao carregar Apps Script."));
    };

    script.src = url;
    document.body.appendChild(script);
  });
}

function exibirModalChamado(chamado) {
  const texto = `Chamado ${chamado.id} registrado com sucesso.\nStatus: ${chamado.status}\nGuarde este número para consulta.`;
  $("#modalTexto").textContent = texto;

  const msg = montarMensagemWhatsapp(chamado);
  const num = CONFIG.WHATSAPP_NUMERO.replace(/\D/g, "");
  const url = num
    ? `https://wa.me/${num}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;

  $("#modalWhatsapp").href = url;
  $("#modalChamado").classList.remove("hidden");
  setTimeout(() => {
    try { window.open(url, "_blank"); } catch(e) {}
  }, 250);
}

function montarMensagemWhatsapp(c) {
  return [
    `*Nova solicitação - Vigilância*`,
    ``,
    `*Chamado:* ${c.id}`,
    `*Status:* ${c.status}`,
    `*Solicitante:* ${c.solicitante}`,
    c.contato ? `*Contato/Ramal:* ${c.contato}` : "",
    `*Origem:* ${c.origem}`,
    c.diretoria ? `*Diretoria:* ${c.diretoria}` : "",
    c.empresa ? `*Empresa:* ${c.empresa}` : "",
    `*Setor/Área:* ${c.setor}`,
    c.temColuna === "Sim" ? `*Coluna:* ${c.coluna}` : "",
    c.temSala === "Sim" ? `*Sala:* ${c.sala}` : "",
    `*Tipo:* ${c.tipo}`,
    `*Detalhe:* ${c.subtipo}${c.outroDetalhe ? " - " + c.outroDetalhe : ""}`,
    `*Prioridade:* ${c.prioridade}`,
    c.turno ? `*Turno:* ${c.turno}` : "",
    c.observacoes ? `*Observações:* ${c.observacoes}` : "",
    ``,
    `*Abertura:* ${formatDateTime(c.dataAbertura)}`
  ].filter(Boolean).join("\n");
}

function bindConsulta() {
  $("#btnConsultar").addEventListener("click", async () => {
    await carregarChamados();
    const id = $("#consultaId").value.trim().toUpperCase();
    const chamado = chamadosCache.find(c => String(c.id).toUpperCase() === id);
    const area = $("#resultadoConsulta");

    if (!id) {
      alert("Digite o número do chamado.");
      return;
    }

    if (!chamado) {
      area.innerHTML = `<div class="card empty">Chamado não encontrado.</div>`;
      return;
    }

    area.innerHTML = renderTicket(chamado, false);
  });
}

function bindPainel() {
  $("#btnAtualizarPainel").addEventListener("click", renderPainel);
  $("#filtroStatus").addEventListener("change", renderPainel);
  $("#filtroTipo").addEventListener("change", renderPainel);
  $("#filtroBusca").addEventListener("input", debounce(renderPainel, 250));
}

async function renderPainel() {
  await carregarChamados();
  renderDashboard();

  const status = $("#filtroStatus").value;
  const tipo = $("#filtroTipo").value;
  const busca = $("#filtroBusca").value.trim().toLowerCase();

  let list = chamadosCache.slice();

  if (status) list = list.filter(c => c.status === status);
  if (tipo) list = list.filter(c => c.tipo === tipo);
  if (busca) {
    list = list.filter(c => JSON.stringify(c).toLowerCase().includes(busca));
  }

  const box = $("#listaChamados");
  if (!list.length) {
    box.innerHTML = `<div class="card empty">Nenhum chamado encontrado.</div>`;
    return;
  }

  box.innerHTML = list.map(c => renderTicket(c, true)).join("");
  box.querySelectorAll("[data-update-status]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const status = btn.dataset.updateStatus;
      await atualizarStatus(id, status);
      renderPainel();
    });
  });
}

function renderDashboard() {
  const hoje = yyyymmdd(new Date());
  const list = chamadosCache;
  const abertosHoje = list.filter(c => yyyymmdd(c.dataAbertura) === hoje && c.status === "Aberto").length;
  const emAtendimento = list.filter(c => c.status === "Em atendimento").length;
  const finalizadosHoje = list.filter(c => yyyymmdd(c.dataFinalizacao || c.dataAbertura) === hoje && c.status === "Finalizado").length;
  const atrasados = list.filter(isAtrasado).length;

  const finalizados = list.filter(c => c.status === "Finalizado" && Number(c.tempoTotalMinutos) > 0);
  const media = finalizados.length
    ? Math.round(finalizados.reduce((acc,c) => acc + Number(c.tempoTotalMinutos || 0), 0) / finalizados.length)
    : null;

  $("#dashAbertosHoje").textContent = abertosHoje;
  $("#dashEmAtendimento").textContent = emAtendimento;
  $("#dashFinalizadosHoje").textContent = finalizadosHoje;
  $("#dashTempoMedio").textContent = media !== null ? `${media} min` : "-";
  $("#dashAtrasados").textContent = atrasados;
  $("#dashTipoTop").textContent = topBy(list, "tipo") || "-";
}

function renderHome() {
  const hoje = yyyymmdd(new Date());
  const list = getLocalChamados();
  $("#homeHoje").textContent = list.filter(c => yyyymmdd(c.dataAbertura) === hoje).length;
  $("#homeAbertos").textContent = list.filter(c => c.status === "Aberto").length;
  $("#homeAtendimento").textContent = list.filter(c => c.status === "Em atendimento").length;
}

function renderTicket(c, admin) {
  const statusClass = String(c.status || "Aberto").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-");

  const tempo = calcularTempoTexto(c);
  const atraso = isAtrasado(c) ? `<span class="badge aberto">Atrasado</span>` : "";

  return `
    <article class="ticket-card">
      <div class="ticket-head">
        <div>
          <div class="ticket-id">${escapeHTML(c.id)}</div>
          <small>${escapeHTML(formatDateTime(c.dataAbertura))}</small>
        </div>
        <div>
          <span class="badge ${statusClass}">${escapeHTML(c.status || "Aberto")}</span>
          ${atraso}
        </div>
      </div>

      <div class="ticket-details">
        <span><b>Solicitante:</b><br>${escapeHTML(c.solicitante || "-")}</span>
        <span><b>Setor/Área:</b><br>${escapeHTML(c.setor || "-")}</span>
        <span><b>Tipo:</b><br>${escapeHTML(c.tipo || "-")}</span>
        <span><b>Detalhe:</b><br>${escapeHTML(c.subtipo || "-")}${c.outroDetalhe ? " - " + escapeHTML(c.outroDetalhe) : ""}</span>
        <span><b>Origem:</b><br>${escapeHTML(c.origem || "-")}</span>
        <span><b>Prioridade:</b><br>${escapeHTML(c.prioridade || "Normal")}</span>
        <span><b>Recebimento:</b><br>${escapeHTML(formatDateTime(c.dataRecebimento) || "-")}</span>
        <span><b>Finalização:</b><br>${escapeHTML(formatDateTime(c.dataFinalizacao) || "-")}</span>
        <span><b>Tempo:</b><br>${escapeHTML(tempo)}</span>
      </div>

      ${c.observacoes ? `<p><b>Observações:</b> ${escapeHTML(c.observacoes)}</p>` : ""}

      <div class="history">
        <b>Histórico</b>
        ${(c.historico || []).map(h => `<div>${escapeHTML(formatDateTime(h.data))} — <b>${escapeHTML(h.status)}</b>: ${escapeHTML(h.descricao || "")}</div>`).join("")}
      </div>

      ${admin ? renderTicketActions(c) : ""}
    </article>
  `;
}

function renderTicketActions(c) {
  if (["Finalizado", "Cancelado"].includes(c.status)) return "";
  const actions = [];

  if (c.status === "Aberto") actions.push(["Recebido", "Marcar como recebido"]);
  if (["Aberto", "Recebido"].includes(c.status)) actions.push(["Em atendimento", "Iniciar atendimento"]);
  if (["Aberto", "Recebido", "Em atendimento"].includes(c.status)) actions.push(["Aguardando solicitante", "Aguardar solicitante"]);
  if (c.status !== "Finalizado") actions.push(["Finalizado", "Finalizar"]);
  if (c.status !== "Cancelado") actions.push(["Cancelado", "Cancelar"]);

  return `
    <div class="ticket-actions">
      ${actions.map(([status,label]) => `
        <button data-update-status="${escapeHTML(status)}" data-id="${escapeHTML(c.id)}" class="${status === "Cancelado" ? "danger" : ""}">${escapeHTML(label)}</button>
      `).join("")}
    </div>
  `;
}

async function atualizarStatus(id, novoStatus) {
  const now = new Date().toISOString();
  const chamados = getLocalChamados();
  const idx = chamados.findIndex(c => c.id === id);
  if (idx < 0) return;

  const c = chamados[idx];
  c.status = novoStatus;

  if (novoStatus === "Recebido" && !c.dataRecebimento) c.dataRecebimento = now;
  if (novoStatus === "Em atendimento" && !c.dataInicioAtendimento) {
    if (!c.dataRecebimento) c.dataRecebimento = now;
    c.dataInicioAtendimento = now;
  }
  if (novoStatus === "Finalizado") {
    if (!c.dataRecebimento) c.dataRecebimento = now;
    if (!c.dataInicioAtendimento) c.dataInicioAtendimento = now;
    c.dataFinalizacao = now;
    c.tempoTotalMinutos = diffMinutes(c.dataAbertura, c.dataFinalizacao);
  }

  c.historico = c.historico || [];
  c.historico.push({
    data: now,
    status: novoStatus,
    descricao: `Status alterado para ${novoStatus}.`
  });

  chamados[idx] = c;
  setLocalChamados(chamados);

  if (CONFIG.USAR_BACKEND && CONFIG.APPS_SCRIPT_URL) {
    try {
      await apiRequest("updateStatus", { id, novoStatus, chamado: c });
    } catch (err) {
      console.warn("Falha ao atualizar backend. Mantido localmente.", err);
    }
  }
}

function isAtrasado(c) {
  if (["Finalizado", "Cancelado"].includes(c.status)) return false;
  const minutos = diffMinutes(c.dataAbertura, new Date().toISOString());
  return minutos > CONFIG.LIMITE_ATRASO_MINUTOS;
}

function calcularTempoTexto(c) {
  if (c.status === "Finalizado" && c.tempoTotalMinutos) return `${c.tempoTotalMinutos} min`;
  const min = diffMinutes(c.dataAbertura, new Date().toISOString());
  return `${min} min em aberto`;
}

function diffMinutes(a, b) {
  if (!a || !b) return 0;
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
}

function topBy(list, key) {
  const counts = {};
  list.forEach(item => {
    const v = item[key];
    if (v) counts[v] = (counts[v] || 0) + 1;
  });
  return Object.entries(counts).sort((a,b) => b[1] - a[1])[0]?.[0] || "";
}

function formatDateTime(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("pt-BR", {
      day:"2-digit", month:"2-digit", year:"numeric",
      hour:"2-digit", minute:"2-digit"
    });
  } catch {
    return "";
  }
}

async function refreshAll() {
  await carregarChamados();
  renderHome();
  if ($("#telaPainel").classList.contains("active")) renderPainel();
}

/* BOT */

function initBot() {
  $("#chatSend").addEventListener("click", handleChatInput);
  $("#chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleChatInput();
  });
}

function restartBot() {
  chatState = {
    step: 0,
    data: {}
  };
  $("#chatMessages").innerHTML = "";
  $("#chatOptions").innerHTML = "";
  botSay("Olá! Vou abrir uma solicitação para a Vigilância. Qual é o nome do solicitante?");
  askText("solicitante");
}

function botSay(text) {
  const div = document.createElement("div");
  div.className = "msg bot";
  div.textContent = text;
  $("#chatMessages").appendChild(div);
  scrollChat();
}

function userSay(text) {
  const div = document.createElement("div");
  div.className = "msg user";
  div.textContent = text;
  $("#chatMessages").appendChild(div);
  scrollChat();
}

function scrollChat() {
  const box = $("#chatMessages");
  box.scrollTop = box.scrollHeight;
}

function askText(key, label) {
  chatState.awaiting = { type:"text", key, label };
  $("#chatInput").disabled = false;
  $("#chatSend").disabled = false;
  $("#chatInput").value = "";
  $("#chatInput").focus();
}

function askOptions(key, question, options) {
  botSay(question);
  chatState.awaiting = { type:"option", key };
  $("#chatInput").disabled = true;
  $("#chatSend").disabled = true;
  const box = $("#chatOptions");
  box.innerHTML = "";
  options.forEach(opt => {
    const btn = document.createElement("button");
    btn.textContent = opt;
    btn.addEventListener("click", () => {
      userSay(opt);
      box.innerHTML = "";
      chatState.data[key] = opt;
      nextBotStep();
    });
    box.appendChild(btn);
  });
}

function handleChatInput() {
  const value = $("#chatInput").value.trim();
  if (!value || !chatState?.awaiting) return;

  const { key } = chatState.awaiting;
  userSay(value);
  chatState.data[key] = value;
  $("#chatInput").value = "";
  nextBotStep();
}

function nextBotStep() {
  const d = chatState.data;
  const keys = Object.keys(d);

  if (!d.contato && d.solicitante && keys.length === 1) {
    botSay("Informe um contato ou ramal. Se não tiver, digite “não informado”.");
    askText("contato");
    return;
  }

  if (!d.origem && d.contato) {
    askOptions("origem", "A solicitação é de qual origem?", ["Stellantis", "Terceiro"]);
    return;
  }

  if (d.origem === "Stellantis" && !d.diretoria) {
    askOptions("diretoria", "Escolha a diretoria:", ["Manufatura", "Logística", "Qualidade", "Engenharia", "Facilities", "Segurança do Trabalho", "Outra"]);
    return;
  }

  if (d.origem === "Terceiro" && !d.empresa) {
    botSay("Informe o nome da empresa terceira.");
    askText("empresa");
    return;
  }

  if (!d.setor) {
    botSay("Informe o setor ou área.");
    askText("setor");
    return;
  }

  if (!d.temColuna) {
    askOptions("temColuna", "Possui coluna?", ["Não", "Sim"]);
    return;
  }

  if (d.temColuna === "Sim" && !d.coluna) {
    botSay("Informe a coluna.");
    askText("coluna");
    return;
  }

  if (!d.temSala) {
    askOptions("temSala", "Possui sala?", ["Não", "Sim"]);
    return;
  }

  if (d.temSala === "Sim" && !d.sala) {
    botSay("Informe a sala.");
    askText("sala");
    return;
  }

  if (!d.tipo) {
    askOptions("tipo", "Qual o tipo de solicitação?", ["Boletim de Ocorrência", "Conferência", "Acompanhamento"]);
    return;
  }

  if (!d.subtipo) {
    askOptions("subtipo", "Escolha o detalhe:", SUBTIPOS[d.tipo] || ["Outros"]);
    return;
  }

  if (d.subtipo === "Outros" && !d.outroDetalhe) {
    botSay("Descreva o item Outros.");
    askText("outroDetalhe");
    return;
  }

  if (!d.prioridade) {
    askOptions("prioridade", "Qual a prioridade?", ["Normal", "Alta", "Urgente"]);
    return;
  }

  if (!d.observacoes) {
    botSay("Digite uma observação. Se não houver, digite “sem observação”.");
    askText("observacoes");
    return;
  }

  finalizarBot();
}

async function finalizarBot() {
  const now = new Date();
  const d = chatState.data;
  const chamado = {
    id: gerarIdChamado(),
    status: "Aberto",
    solicitante: d.solicitante || "",
    contato: d.contato === "não informado" ? "" : d.contato,
    origem: d.origem || "",
    diretoria: d.diretoria || "",
    empresa: d.empresa || "",
    setor: d.setor || "",
    temColuna: d.temColuna || "Não",
    coluna: d.coluna || "",
    temSala: d.temSala || "Não",
    sala: d.sala || "",
    tipo: d.tipo || "",
    subtipo: d.subtipo || "",
    outroDetalhe: d.outroDetalhe || "",
    prioridade: d.prioridade || "Normal",
    turno: "",
    observacoes: d.observacoes === "sem observação" ? "" : d.observacoes,
    dataAbertura: now.toISOString(),
    dataRecebimento: "",
    dataInicioAtendimento: "",
    dataFinalizacao: "",
    tempoTotalMinutos: "",
    responsavel: "",
    historico: [{
      data: now.toISOString(),
      status: "Aberto",
      descricao: "Chamado registrado pelo bot."
    }]
  };

  await salvarChamado(chamado);
  botSay(`Chamado registrado com sucesso!\n\nNúmero: ${chamado.id}\nStatus: ${chamado.status}\n\nGuarde esse número para consulta.`);
  exibirModalChamado(chamado);
  refreshAll();

  $("#chatInput").disabled = true;
  $("#chatSend").disabled = true;
  $("#chatOptions").innerHTML = `<button onclick="restartBot()">Abrir outro chamado</button>`;
}

/* Utils */

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}
