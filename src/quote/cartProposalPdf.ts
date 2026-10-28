// DXFAST :: Proposta Comercial do Carrinho (lote de pecas variadas) em PDF A4
// Lista os itens do lote, o resumo de producao (chapas por espessura) e a
// composicao de preco de VENDA (com margem embutida, sem expor custo bruto nem a
// porcentagem de margem). Proibido o caractere traco-longo em qualquer string.

import { jsPDF } from 'jspdf';
import { CompanyConfig, MaterialConfig, ClientInfo } from '../types/admin';
import { CartItem, CartQuoteResult } from './cartQuote';
import { savePdfDoc } from '../utils/download';

export interface CartProposalInput {
  company: CompanyConfig;
  items: CartItem[];
  quote: CartQuoteResult;
  materials: MaterialConfig[];
  client?: ClientInfo;
  proposalNumber?: string;
  dateISO?: string;
}

function sanitizeFileName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 50);
}
function formatBrl(val: number): string {
  return `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function generateCartProposalPdf(input: CartProposalInput): void {
  const { company, items, quote, materials, client, proposalNumber, dateISO } = input;
  const matById = new Map(materials.map((m) => [m.id, m]));

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210, pageHeight = 297, marginX = 16;
  const contentWidth = pageWidth - 2 * marginX;

  const now = dateISO ? new Date(dateISO) : new Date();
  const dateFormatted = now.toLocaleDateString('pt-BR');
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const propNumber = proposalNumber || `LOTE-${yyyy}${mm}${dd}-${hh}${min}`;
  const validityDays = company.defaultQuoteValidityDays || 10;

  let cursorY = 16;
  const footer = (pageNum: number, pageTotal: number) => {
    const fY = pageHeight - 8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(148, 163, 184);
    doc.text('DXFAST - Sistema Especialista de Corte e Dobra Industrial CNC', marginX, fY);
    doc.text(`Pagina ${pageNum} de ${pageTotal}`, marginX + contentWidth, fY, { align: 'right' });
  };
  const ensureSpace = (needed: number) => {
    if (cursorY + needed > pageHeight - 16) { doc.addPage(); cursorY = 16; }
  };

  // 1. Cabecalho da empresa
  doc.setFillColor(248, 250, 252); doc.setDrawColor(226, 232, 240);
  doc.roundedRect(marginX, cursorY, contentWidth, 34, 3, 3, 'FD');
  let textStartX = marginX + 6;
  const logoX = marginX + 4, logoY = cursorY + 4;
  if (company.logoUrl && company.logoUrl.startsWith('data:image/')) {
    try { doc.addImage(company.logoUrl, 'PNG', logoX, logoY, 26, 26); textStartX = logoX + 30; } catch { /* ignora logo invalido */ }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(15, 23, 42);
  doc.text(company.tradeName?.trim() || company.name?.trim() || 'DXFAST CORTE E DOBRA INDUSTRIAL', textStartX, cursorY + 8);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(71, 85, 105);
  if (company.name && company.tradeName && company.name !== company.tradeName) doc.text(`Razao Social: ${company.name}`, textStartX, cursorY + 13);
  const fiscal: string[] = [];
  if (company.cnpj) fiscal.push(`CNPJ: ${company.cnpj}`);
  if (company.ie) fiscal.push(`IE: ${company.ie}`);
  if (fiscal.length) doc.text(fiscal.join(' | '), textStartX, cursorY + 18);
  const addr = company.address;
  const addrStr = [addr?.street && `${addr.street}${addr.number ? `, ${addr.number}` : ''}`, addr?.neighborhood,
    addr?.city && addr?.state ? `${addr.city}/${addr.state}` : (addr?.city || addr?.state), addr?.zipCode && `CEP ${addr.zipCode}`]
    .filter(Boolean).join(', ');
  if (addrStr) doc.text(addrStr, textStartX, cursorY + 23);
  const contact: string[] = [];
  if (company.phone) contact.push(`Tel: ${company.phone}`);
  if (company.email) contact.push(`Email: ${company.email}`);
  if (contact.length) doc.text(contact.join(' | '), textStartX, cursorY + 28);
  cursorY += 40;

  // 2. Faixa de identificacao
  doc.setFillColor(15, 23, 42); doc.roundedRect(marginX, cursorY, contentWidth, 14, 2, 2, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255);
  doc.text('PROPOSTA COMERCIAL - LOTE DE CORTE', marginX + 6, cursorY + 9);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(203, 213, 225);
  doc.text(`N: ${propNumber}   |   Emissao: ${dateFormatted}   |   Validade: ${validityDays} dias`, marginX + contentWidth - 6, cursorY + 9, { align: 'right' });
  cursorY += 19;

  // 2b. Dados do cliente (quando informado)
  const hasClient = Boolean(client && (client.name || client.company || client.contact || client.cnpj));
  if (hasClient && client) {
    doc.setFillColor(255, 255, 255); doc.setDrawColor(226, 232, 240);
    doc.roundedRect(marginX, cursorY, contentWidth, 14, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139);
    doc.text('CLIENTE', marginX + 4, cursorY + 5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(15, 23, 42);
    doc.text(client.name?.trim() || client.company?.trim() || '', marginX + 4, cursorY + 10.5);
    const rb: string[] = [];
    if (client.company && client.name && client.company !== client.name) rb.push(client.company);
    if (client.cnpj) rb.push(`CNPJ: ${client.cnpj}`);
    if (client.contact) rb.push(client.contact);
    if (rb.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(71, 85, 105); doc.text(rb.join('   |   '), marginX + contentWidth - 4, cursorY + 9, { align: 'right' }); }
    cursorY += 18;
  }

  // 3. Tabela de itens do lote
  doc.setFillColor(241, 245, 249); doc.setDrawColor(203, 213, 225);
  doc.rect(marginX, cursorY, contentWidth, 8, 'FD');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42);
  const colQtd = marginX + contentWidth - 60;
  const colThk = marginX + contentWidth - 42;
  const colDim = marginX + contentWidth - 4;
  doc.text('Item', marginX + 4, cursorY + 5.5);
  doc.text('Qtd', colQtd, cursorY + 5.5, { align: 'right' });
  doc.text('Esp.', colThk, cursorY + 5.5, { align: 'right' });
  doc.text('Dimensoes (mm)', colDim, cursorY + 5.5, { align: 'right' });
  cursorY += 8;

  doc.setFontSize(8.5);
  items.forEach((it, idx) => {
    ensureSpace(10);
    const rowH = 9;
    if (idx % 2 === 1) { doc.setFillColor(248, 250, 252); doc.rect(marginX, cursorY, contentWidth, rowH, 'F'); }
    doc.setDrawColor(226, 232, 240); doc.line(marginX, cursorY + rowH, marginX + contentWidth, cursorY + rowH);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
    const nm = doc.splitTextToSize(`${String(idx + 1).padStart(2, '0')}. ${it.name}`, contentWidth - 70)[0];
    doc.text(nm, marginX + 4, cursorY + 6);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(51, 65, 85);
    doc.text(`${it.qty}`, colQtd, cursorY + 6, { align: 'right' });
    doc.text(`${it.thicknessMm} mm`, colThk, cursorY + 6, { align: 'right' });
    doc.text(`${Math.round(it.geometry.metrics.blankWidthMm)} x ${Math.round(it.geometry.metrics.blankHeightMm)}`, colDim, cursorY + 6, { align: 'right' });
    cursorY += rowH;
  });
  cursorY += 6;

  // 4. Resumo de producao (chapas por espessura)
  ensureSpace(14 + quote.groups.length * 6);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(15, 23, 42);
  doc.text('Resumo de Producao', marginX + 4, cursorY + 4);
  cursorY += 8;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(71, 85, 105);
  for (const g of quote.groups) {
    const mat = g.sheet ? matById.get(g.sheet.materialId) : undefined;
    const matName = mat?.name || mat?.code || 'Aco';
    const sheetDim = g.sheet ? `${g.sheet.widthMm}x${g.sheet.lengthMm} mm` : 'chapa nao definida';
    doc.text(`Espessura ${g.thicknessMm} mm (${matName}): ${g.totalParts} peca(s) em ${g.sheetsNeeded} chapa(s) de ${sheetDim}`, marginX + 4, cursorY);
    cursorY += 6;
  }
  doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
  doc.text(`Total: ${quote.totalParts} peca(s) em ${quote.totalSheets} chapa(s)`, marginX + 4, cursorY);
  cursorY += 6;
  doc.setFont('helvetica', 'normal'); doc.setTextColor(71, 85, 105); doc.setFontSize(8);
  doc.text(`Peso estimado das pecas (frete): ${quote.orderWeightKg.toFixed(1)} kg`, marginX + 4, cursorY);
  cursorY += 8;

  // 5. Composicao de preco de VENDA (margem embutida; sem custo bruto)
  const m = quote.marginPercent / 100;
  const rows: { label: string; value: number }[] = [
    { label: 'Materia-Prima (chapas de aco / metal)', value: quote.materialCost * (1 + m) },
    { label: 'Corte CNC de alta precisao', value: quote.cuttingCost * (1 + m) },
  ];
  if (quote.bendingCost > 0) rows.push({ label: 'Dobra e conformacao CNC', value: quote.bendingCost * (1 + m) });
  rows.push({ label: 'Preparacao fabril (setup de maquinas)', value: quote.setupCost * (1 + m) });

  ensureSpace(10 + rows.length * 10 + 30);
  doc.setFillColor(241, 245, 249); doc.setDrawColor(203, 213, 225);
  doc.rect(marginX, cursorY, contentWidth, 8, 'FD');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42);
  doc.text('Composicao do Fornecimento', marginX + 4, cursorY + 5.5);
  doc.text('Valor de Venda (BRL)', marginX + contentWidth - 4, cursorY + 5.5, { align: 'right' });
  cursorY += 8;
  rows.forEach((row, idx) => {
    const rowH = 10;
    if (idx % 2 === 1) { doc.setFillColor(248, 250, 252); doc.rect(marginX, cursorY, contentWidth, rowH, 'F'); }
    doc.setDrawColor(226, 232, 240); doc.line(marginX, cursorY + rowH, marginX + contentWidth, cursorY + rowH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42);
    doc.text(row.label, marginX + 4, cursorY + 6.5);
    doc.setFontSize(9);
    doc.text(formatBrl(row.value), marginX + contentWidth - 4, cursorY + 6.5, { align: 'right' });
    cursorY += rowH;
  });
  cursorY += 5;

  // 6. Destaque do total
  ensureSpace(24);
  const boxH = 22;
  doc.setFillColor(15, 23, 42); doc.roundedRect(marginX, cursorY, contentWidth, boxH, 2.5, 2.5, 'F');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(148, 163, 184);
  doc.text(`VALOR TOTAL DA PROPOSTA (${quote.totalParts} PECAS, ${quote.totalSheets} CHAPAS)`, marginX + 6, cursorY + 8);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(74, 222, 128);
  doc.text(formatBrl(quote.total), marginX + 6, cursorY + 17);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(203, 213, 225);
  doc.text('Moeda corrente nacional (BRL) - Valores liquidos, preparacao e impostos inclusos', marginX + contentWidth - 6, cursorY + 17, { align: 'right' });
  cursorY += boxH + 8;

  // 7. Termos
  ensureSpace(40);
  doc.setFillColor(248, 250, 252); doc.setDrawColor(226, 232, 240);
  doc.roundedRect(marginX, cursorY, contentWidth, 34, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(15, 23, 42);
  doc.text('CONDICOES COMERCIAIS E TERMOS GERAIS DE FORNECIMENTO', marginX + 4, cursorY + 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(71, 85, 105);
  const terms = company.standardTerms ||
    '1. Prazo de fabricacao a confirmar apos aprovacao formal e emissao do pedido.\n2. Tolerancias de corte conforme DIN EN ISO 9013.\n3. Material conforme especificacoes e certificados de usina.\n4. Condicoes de pagamento conforme acordado com o comercial.';
  doc.text(doc.splitTextToSize(terms, contentWidth - 8).slice(0, 5), marginX + 4, cursorY + 11);
  doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5); doc.setTextColor(148, 163, 184);
  doc.text('Nota: valores e prazos podem ser atualizados conforme analise final de viabilidade e disponibilidade de materia-prima.', marginX + 4, cursorY + 30);

  // rodape em todas as paginas
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) { doc.setPage(p); footer(p, total); }

  savePdfDoc(doc, `Proposta_Lote_${sanitizeFileName(propNumber)}_${yyyy}${mm}${dd}.pdf`);
}
