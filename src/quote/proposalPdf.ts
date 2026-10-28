// DXFAST :: Commercial Proposal PDF Generator
// Generates professional, clean A4 portrait PDF quotations for end-clients.
// Strictly NO margin leakage, NO raw costs. Strictly NO em-dash in strings. Brazilian Portuguese UI.

import { jsPDF } from 'jspdf';
import { CompanyConfig, ClientInfo } from '../types/admin';
import { TemplateDefinition, GeometryResult } from '../types/cad';
import { QuoteResult } from './quoteTypes';
import { render3dIsometricSnapshot } from '../engine/snapshot3d';
import { savePdfDoc } from '../utils/download';

export interface ProposalInput {
  company: CompanyConfig;
  quote: QuoteResult; // retorno nao-bloqueado de computeQuote
  partName: string;
  template: TemplateDefinition;
  geometry: GeometryResult;
  params: Record<string, number>;
  thicknessMm: number;
  materialName: string;
  client?: ClientInfo;
  proposalNumber?: string;
  dateISO?: string;
}

/**
 * Sanitizes file name removing invalid OS path characters.
 */
function sanitizeFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 50);
}

/**
 * Formats monetary number to Brazilian standard (ex: "R$ 1.250,50").
 */
function formatBrl(val: number): string {
  return `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Pure generator function creating commercial proposal PDF document and initiating browser download.
 */
export function generateProposalPdf(input: ProposalInput): void {
  const {
    company,
    quote,
    partName,
    template,
    geometry,
    params,
    thicknessMm,
    materialName,
    client,
    proposalNumber,
    dateISO,
  } = input;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 16;
  const contentWidth = pageWidth - 2 * marginX;

  // Commercial Sale Value Invariant (Zero Margin Leakage)
  const m = quote.marginPercent / 100;
  const q = quote.quantity;

  const materialSale = quote.material.materialCostPerPiece * (1 + m);
  const cutSale = (quote.cutting.cutCostPerPiece + quote.cutting.cutSetupLotCost / q) * (1 + m);
  const bendSale = (quote.bending.bendCostPerPiece + quote.bending.bendSetupLotCost / q) * (1 + m);

  // Proposal Metadata
  const now = dateISO ? new Date(dateISO) : new Date();
  const dateFormatted = now.toLocaleDateString('pt-BR');
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');

  const propNumber = proposalNumber || `PROP-${yyyy}${mm}${dd}-${hh}${min}`;
  const validityDays = company.defaultQuoteValidityDays || 10;

  let cursorY = 16;

  // ---------------------------------------------------------------------------
  // 1. CABECALHO (DADOS DO EMISSOR / EMPRESA)
  // ---------------------------------------------------------------------------
  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.roundedRect(marginX, cursorY, contentWidth, 34, 3, 3, 'FD');

  const logoX = marginX + 4;
  const logoY = cursorY + 4;
  let textStartX = marginX + 6;

  // Inserir logo se existir e for valido
  if (company.logoUrl && company.logoUrl.startsWith('data:image/')) {
    try {
      doc.addImage(company.logoUrl, 'PNG', logoX, logoY, 26, 26);
      textStartX = logoX + 30;
    } catch {
      // Falha silenciosa no logo se o formato for invalido
    }
  }

  // Nome da Empresa Emissora
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42); // slate-900
  const companyTitle = company.tradeName?.trim() || company.name?.trim() || 'DXFAST CORTE E DOBRA INDUSTRIAL';
  doc.text(companyTitle, textStartX, cursorY + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105); // slate-600

  if (company.name && company.tradeName && company.name !== company.tradeName) {
    doc.text(`Razao Social: ${company.name}`, textStartX, cursorY + 13);
  }

  const fiscalParts: string[] = [];
  if (company.cnpj) fiscalParts.push(`CNPJ: ${company.cnpj}`);
  if (company.ie) fiscalParts.push(`IE: ${company.ie}`);
  if (fiscalParts.length > 0) {
    doc.text(fiscalParts.join(' | '), textStartX, cursorY + 18);
  }

  const addr = company.address;
  const addrStr = [
    addr.street && `${addr.street}${addr.number ? `, ${addr.number}` : ''}`,
    addr.neighborhood,
    addr.city && addr.state ? `${addr.city}/${addr.state}` : (addr.city || addr.state),
    addr.zipCode && `CEP ${addr.zipCode}`,
  ]
    .filter(Boolean)
    .join(', ');

  if (addrStr) {
    doc.text(addrStr, textStartX, cursorY + 23);
  }

  const contactParts: string[] = [];
  if (company.phone) contactParts.push(`Tel: ${company.phone}`);
  if (company.email) contactParts.push(`Email: ${company.email}`);
  if (contactParts.length > 0) {
    doc.text(contactParts.join(' | '), textStartX, cursorY + 28);
  }

  cursorY += 40;

  // ---------------------------------------------------------------------------
  // 2. IDENTIFICACAO DA PROPOSTA COMERCIAL (FAIXA SUPERIOR)
  // ---------------------------------------------------------------------------
  doc.setFillColor(15, 23, 42); // slate-900
  doc.roundedRect(marginX, cursorY, contentWidth, 14, 2, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text('PROPOSTA COMERCIAL', marginX + 6, cursorY + 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225); // slate-300
  const metaText = `N: ${propNumber}   |   Emissao: ${dateFormatted}   |   Validade: ${validityDays} dias`;
  doc.text(metaText, marginX + contentWidth - 6, cursorY + 9, { align: 'right' });

  cursorY += 19;

  // ---------------------------------------------------------------------------
  // 2b. DADOS DO CLIENTE (quando informado)
  // ---------------------------------------------------------------------------
  const hasClient = Boolean(client && (client.name || client.company || client.contact || client.cnpj));
  if (hasClient && client) {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(marginX, cursorY, contentWidth, 14, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('CLIENTE', marginX + 4, cursorY + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    const clientTitle = client.name?.trim() || client.company?.trim() || '';
    doc.text(clientTitle, marginX + 4, cursorY + 10.5);
    const rightBits: string[] = [];
    if (client.company && client.name && client.company !== client.name) rightBits.push(client.company);
    if (client.cnpj) rightBits.push(`CNPJ: ${client.cnpj}`);
    if (client.contact) rightBits.push(client.contact);
    if (rightBits.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(rightBits.join('   |   '), marginX + contentWidth - 4, cursorY + 9, { align: 'right' });
    }
    cursorY += 18;
  }

  // ---------------------------------------------------------------------------
  // 3. DADOS DA PECA E VISUALIZACAO ISOMETRICA 3D
  // ---------------------------------------------------------------------------
  const block3DHeight = 57;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(marginX, cursorY, contentWidth, block3DHeight, 2, 2, 'FD');

  // Gerar snapshot 3D isometrico limpo
  let img3d: string | null = null;
  try {
    img3d = render3dIsometricSnapshot(geometry, template, params, thicknessMm, 800, 520);
  } catch {
    img3d = null;
  }

  // Largura da coluna esquerda (detalhes tecnicos) e direita (render 3D)
  const leftColWidth = img3d ? contentWidth * 0.58 : contentWidth - 12;
  const leftColX = marginX + 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  const displayPartName = partName.trim() || template.name;
  doc.text(`Item 01: ${displayPartName}`, leftColX, cursorY + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);

  let itemInfoY = cursorY + 16;
  const lineSpacing = 6;

  doc.text(`Modelo Base: ${template.name}`, leftColX, itemInfoY);
  itemInfoY += lineSpacing;

  doc.text(`Material Especificado: ${materialName}`, leftColX, itemInfoY);
  itemInfoY += lineSpacing;

  doc.text(`Espessura da Chapa: ${thicknessMm.toFixed(2)} mm`, leftColX, itemInfoY);
  itemInfoY += lineSpacing;

  const blankW = Math.round(geometry.metrics.blankWidthMm);
  const blankH = Math.round(geometry.metrics.blankHeightMm);
  doc.text(`Dimensoes do Blank Desdobrado: ${blankW} x ${blankH} mm`, leftColX, itemInfoY);
  itemInfoY += lineSpacing;

  const bendCount = geometry.metrics.bendCount || 0;
  const bendInfo = bendCount > 0 ? `${bendCount} dobra(s) CNC programada(s)` : 'Peca plana (sem dobras)';
  doc.text(`Conformacao: ${bendInfo}`, leftColX, itemInfoY);
  itemInfoY += lineSpacing;

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 48, 0); // brand red #FF3000
  doc.text(`Quantidade Solicitada no Lote: ${q} peca(s)`, leftColX, itemInfoY);

  // Inserir quadro 3D a direita se a imagem foi gerada com sucesso
  if (img3d) {
    const imgBoxX = marginX + contentWidth * 0.60;
    const imgBoxY = cursorY + 4;
    const imgBoxW = contentWidth * 0.38;
    const imgBoxH = block3DHeight - 8;

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(241, 245, 249);
    doc.roundedRect(imgBoxX, imgBoxY, imgBoxW, imgBoxH, 2, 2, 'FD');

    try {
      doc.addImage(img3d, 'PNG', imgBoxX + 1, imgBoxY + 1, imgBoxW - 2, imgBoxH - 2);
    } catch {
      // Se falhar a renderizacao da imagem, mantem o quadro limpo
    }
  }

  cursorY += block3DHeight + 6;

  // ---------------------------------------------------------------------------
  // 4. TABELA DE COMPOSICAO DE PRECO DE VENDA (SEM MARGEM NEM CUSTO BRUTO)
  // ---------------------------------------------------------------------------
  doc.setFillColor(241, 245, 249); // slate-100
  doc.setDrawColor(203, 213, 225); // slate-300
  doc.rect(marginX, cursorY, contentWidth, 8, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Descricao do Escopo Fabril', marginX + 4, cursorY + 5.5);
  doc.text('Valor Unitario de Venda (BRL)', marginX + contentWidth - 4, cursorY + 5.5, { align: 'right' });

  cursorY += 8;

  // Linhas de Escopo com precos de venda por peca
  const scopeRows: { label: string; desc: string; value: number }[] = [
    {
      label: 'Materia-Prima (Chapa de Aco / Metal)',
      desc: `Fornecimento e corte de chapa ${materialName} #${thicknessMm.toFixed(2)} mm`,
      value: materialSale,
    },
    {
      label: 'Corte CNC de Alta Precisao',
      desc: 'Execucao em mesa CNC industrial, contornos fechados e furacoes conforme especificacao',
      value: cutSale,
    },
  ];

  if (quote.bending.bendCount > 0) {
    scopeRows.push({
      label: 'Dobra e Conformacao CNC',
      desc: `Execucao de ${quote.bending.bendCount} dobra(s) em prensa dobradeira CNC com compensacao analitica`,
      value: bendSale,
    });
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);

  scopeRows.forEach((row, idx) => {
    const rowH = 12;
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(marginX, cursorY, contentWidth, rowH, 'F');
    }
    doc.setDrawColor(226, 232, 240);
    doc.line(marginX, cursorY + rowH, marginX + contentWidth, cursorY + rowH);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(row.label, marginX + 4, cursorY + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(row.desc, marginX + 4, cursorY + 9.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(formatBrl(row.value), marginX + contentWidth - 4, cursorY + 7, { align: 'right' });

    cursorY += rowH;
  });

  cursorY += 4;

  // ---------------------------------------------------------------------------
  // 5. DESTAQUE COMERCIAL DE VALORES FINAIS
  // ---------------------------------------------------------------------------
  const totalBoxH = 26;
  doc.setFillColor(15, 23, 42); // slate-900
  doc.roundedRect(marginX, cursorY, contentWidth, totalBoxH, 2.5, 2.5, 'F');

  // Lado esquerdo: Preco Unitario
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text('PRECO UNITARIO LIQUIDO (POR PECA)', marginX + 6, cursorY + 7);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(255, 48, 0); // #FF3000
  doc.text(formatBrl(quote.unitPrice), marginX + 6, cursorY + 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(203, 213, 225);
  doc.text(`Valor ja contempla preparacao fabril e impostos aplicaveis`, marginX + 6, cursorY + 21);

  // Divisoria vertical sutil
  doc.setDrawColor(51, 65, 85);
  doc.line(marginX + contentWidth * 0.52, cursorY + 4, marginX + contentWidth * 0.52, cursorY + totalBoxH - 4);

  // Lado direito: Preco Total do Lote
  const rightColX = marginX + contentWidth * 0.56;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(`VALOR TOTAL DA PROPOSTA (LOTE DE ${q} PECAS)`, rightColX, cursorY + 7);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(74, 222, 128); // emerald-400
  doc.text(formatBrl(quote.totalPrice), rightColX, cursorY + 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(203, 213, 225);
  doc.text('Moeda corrente nacional (BRL) - Valores liquidos', rightColX, cursorY + 21);

  cursorY += totalBoxH + 8;

  // ---------------------------------------------------------------------------
  // 6. TERMOS GERAIS DE FORNECIMENTO E RODAPE
  // ---------------------------------------------------------------------------
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(marginX, cursorY, contentWidth, 38, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('CONDICOES COMERCIAIS E TERMOS GERAIS DE FORNECIMENTO', marginX + 4, cursorY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);

  const defaultTerms =
    company.standardTerms ||
    '1. Prazo de fabricacao a confirmar apos aprovacao formal da proposta e emissao do pedido.\n2. Tolerancias dimensionais de corte conforme norma tecnica DIN EN ISO 9013.\n3. O material fornecido atende as especificacoes tecnicas e certificados de usina.\n4. Condicoes de pagamento: conforme acordado previamente com nosso departamento comercial.';

  const splitTerms = doc.splitTextToSize(defaultTerms, contentWidth - 8);
  doc.text(splitTerms.slice(0, 5), marginX + 4, cursorY + 11);

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6.5);
  doc.setTextColor(148, 163, 184);
  const disclaimer = 'Nota: os valores e prazos podem sofrer atualizacoes conforme analise final de viabilidade geometrica e disponibilidade de materia-prima.';
  doc.text(disclaimer, marginX + 4, cursorY + 34);

  // ---------------------------------------------------------------------------
  // 7. RODAPE INFERIOR DA PAGINA
  // ---------------------------------------------------------------------------
  const footerY = pageHeight - 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text('DXFAST - Sistema Especialista de Corte e Dobra Industrial CNC', marginX, footerY);
  doc.text('Pagina 1 de 1', marginX + contentWidth, footerY, { align: 'right' });

  // Nome do arquivo de download: Proposta_<partName_sanitizado>_<AAAAMMDD>.pdf
  const safePart = sanitizeFileName(partName.trim() || template.id);
  const fileName = `Proposta_${safePart}_${yyyy}${mm}${dd}.pdf`;

  savePdfDoc(doc, fileName);
}
