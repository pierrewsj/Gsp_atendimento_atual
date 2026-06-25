/*
  Backend Google Apps Script - Solicitações Vigilância v2

  Como usar:
  1. Crie uma planilha Google.
  2. Vá em Extensões > Apps Script.
  3. Cole este código.
  4. Implante como "Aplicativo da Web".
  5. Acesso: "Qualquer pessoa com o link".
  6. Copie a URL que termina em /exec.
  7. Cole no app.js em CONFIG.APPS_SCRIPT_URL e mude CONFIG.USAR_BACKEND para true.
*/

const SHEET_NAME = "chamados";

const HEADERS = [
  "id",
  "status",
  "solicitante",
  "contato",
  "origem",
  "diretoria",
  "empresa",
  "setor",
  "temColuna",
  "coluna",
  "temSala",
  "sala",
  "tipo",
  "subtipo",
  "outroDetalhe",
  "prioridade",
  "turno",
  "observacoes",
  "dataAbertura",
  "dataRecebimento",
  "dataInicioAtendimento",
  "dataFinalizacao",
  "tempoTotalMinutos",
  "responsavel",
  "historicoJson"
];

function doGet(e) {
  const action = e.parameter.action || "";
  const callback = e.parameter.callback || "callback";
  let payload = {};

  try {
    payload = e.parameter.payload ? JSON.parse(e.parameter.payload) : {};
  } catch (err) {
    return jsonp(callback, { ok:false, error:"Payload inválido" });
  }

  try {
    setupSheet_();

    if (action === "save") {
      return jsonp(callback, saveChamado_(payload.chamado));
    }

    if (action === "list") {
      return jsonp(callback, { ok:true, chamados:listChamados_() });
    }

    if (action === "status") {
      const chamado = findChamado_(payload.id);
      return jsonp(callback, { ok:!!chamado, chamado });
    }

    if (action === "updateStatus") {
      return jsonp(callback, updateStatus_(payload.id, payload.novoStatus, payload.chamado));
    }

    return jsonp(callback, { ok:false, error:"Ação não reconhecida" });
  } catch (err) {
    return jsonp(callback, { ok:false, error:String(err) });
  }
}

function jsonp(callback, obj) {
  const safeCallback = String(callback).replace(/[^\w$.]/g, "");
  return ContentService
    .createTextOutput(`${safeCallback}(${JSON.stringify(obj)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function setupSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);

  const firstRow = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const needsHeader = firstRow.join("") === "" || firstRow[0] !== "id";

  if (needsHeader) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  }
}

function saveChamado_(chamado) {
  if (!chamado || !chamado.id) return { ok:false, error:"Chamado sem ID" };

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  const existing = findRowById_(chamado.id);

  if (existing > 0) {
    writeChamadoRow_(sh, existing, chamado);
  } else {
    sh.appendRow(chamadoToRow_(chamado));
  }

  return { ok:true, chamado };
}

function listChamados_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const values = sh.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  return values
    .filter(row => row[0])
    .map(rowToChamado_)
    .sort((a,b) => new Date(b.dataAbertura) - new Date(a.dataAbertura));
}

function findChamado_(id) {
  return listChamados_().find(c => String(c.id).toUpperCase() === String(id).toUpperCase()) || null;
}

function updateStatus_(id, novoStatus, chamadoAtualizado) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  const row = findRowById_(id);
  if (row < 0) return { ok:false, error:"Chamado não encontrado" };

  if (chamadoAtualizado && chamadoAtualizado.id) {
    writeChamadoRow_(sh, row, chamadoAtualizado);
    return { ok:true, chamado:chamadoAtualizado };
  }

  const chamado = rowToChamado_(sh.getRange(row, 1, 1, HEADERS.length).getValues()[0]);
  const now = new Date().toISOString();
  chamado.status = novoStatus;

  if (novoStatus === "Recebido" && !chamado.dataRecebimento) chamado.dataRecebimento = now;
  if (novoStatus === "Em atendimento" && !chamado.dataInicioAtendimento) {
    if (!chamado.dataRecebimento) chamado.dataRecebimento = now;
    chamado.dataInicioAtendimento = now;
  }
  if (novoStatus === "Finalizado") {
    if (!chamado.dataRecebimento) chamado.dataRecebimento = now;
    if (!chamado.dataInicioAtendimento) chamado.dataInicioAtendimento = now;
    chamado.dataFinalizacao = now;
    chamado.tempoTotalMinutos = Math.max(0, Math.round((new Date(chamado.dataFinalizacao) - new Date(chamado.dataAbertura)) / 60000));
  }

  chamado.historico = chamado.historico || [];
  chamado.historico.push({
    data: now,
    status: novoStatus,
    descricao: "Status alterado na planilha."
  });

  writeChamadoRow_(sh, row, chamado);
  return { ok:true, chamado };
}

function findRowById_(id) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;

  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const idx = ids.findIndex(v => String(v).toUpperCase() === String(id).toUpperCase());
  return idx >= 0 ? idx + 2 : -1;
}

function writeChamadoRow_(sh, row, chamado) {
  sh.getRange(row, 1, 1, HEADERS.length).setValues([chamadoToRow_(chamado)]);
}

function chamadoToRow_(c) {
  return [
    c.id || "",
    c.status || "",
    c.solicitante || "",
    c.contato || "",
    c.origem || "",
    c.diretoria || "",
    c.empresa || "",
    c.setor || "",
    c.temColuna || "",
    c.coluna || "",
    c.temSala || "",
    c.sala || "",
    c.tipo || "",
    c.subtipo || "",
    c.outroDetalhe || "",
    c.prioridade || "",
    c.turno || "",
    c.observacoes || "",
    c.dataAbertura || "",
    c.dataRecebimento || "",
    c.dataInicioAtendimento || "",
    c.dataFinalizacao || "",
    c.tempoTotalMinutos || "",
    c.responsavel || "",
    JSON.stringify(c.historico || [])
  ];
}

function rowToChamado_(row) {
  let historico = [];
  try {
    historico = row[24] ? JSON.parse(row[24]) : [];
  } catch (e) {
    historico = [];
  }

  return {
    id: row[0] || "",
    status: row[1] || "",
    solicitante: row[2] || "",
    contato: row[3] || "",
    origem: row[4] || "",
    diretoria: row[5] || "",
    empresa: row[6] || "",
    setor: row[7] || "",
    temColuna: row[8] || "",
    coluna: row[9] || "",
    temSala: row[10] || "",
    sala: row[11] || "",
    tipo: row[12] || "",
    subtipo: row[13] || "",
    outroDetalhe: row[14] || "",
    prioridade: row[15] || "",
    turno: row[16] || "",
    observacoes: row[17] || "",
    dataAbertura: row[18] || "",
    dataRecebimento: row[19] || "",
    dataInicioAtendimento: row[20] || "",
    dataFinalizacao: row[21] || "",
    tempoTotalMinutos: row[22] || "",
    responsavel: row[23] || "",
    historico
  };
}
