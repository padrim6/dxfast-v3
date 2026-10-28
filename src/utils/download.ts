// Utilitário de download resiliente a ambientes incorporados (iframe/sandbox).
// Tres cenarios:
//  1) Dentro do visualizador de artefato da Claude: o download comum e bloqueado,
//     mas existe uma API propria (window.claude -> capability "downloads") que
//     mostra uma confirmacao e salva o arquivo. Usada primeiro quando presente.
//  2) Pagina de topo (deploy normal, ex.: Vercel): download padrao via link.
//  3) Incorporado sem a API (outro embed): abre em nova aba / copia o conteudo.
// Proibido o caractere traco-longo em qualquer string.

import { showToast } from '../components/ui/toast';

// A lista de extensoes que a API de download do artefato aceita NAO inclui .dxf.
// Quando a extensao e recusada, oferecemos o mesmo conteudo como .txt (que abre
// em qualquer editor e pode ser renomeado para a extensao original).
const CLAUDE_ALLOWED_EXT = new Set([
  'gif', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mov', 'txt', 'json', 'md',
  'docx', 'pptx', 'epub', 'csv', 'ttf', 'html', 'svg', 'pdf', 'xlsx', 'zip', 'fig',
]);

function extOf(filename: string): string {
  const m = /\.([^.]+)$/.exec(filename);
  return m ? m[1].toLowerCase() : '';
}

type CapabilityOutcome = 'saved' | 'declined' | 'rejected_extension' | 'unavailable';

/**
 * Tenta salvar pela API de download do artefato (quando a pagina roda dentro do
 * visualizador da Claude). Retorna 'unavailable' quando a API nao existe (e o
 * caso de um deploy normal), para o chamador cair no metodo classico.
 */
async function trySaveViaClaude(filename: string, data: Blob | string): Promise<CapabilityOutcome> {
  try {
    const c: any = (window as any).claude;
    if (!c || typeof c.use !== 'function') return 'unavailable';
    const dl = await c.use('downloads');
    if (!dl || typeof dl.save !== 'function') return 'unavailable';
    await dl.save({ filename, data });
    return 'saved';
  } catch (err: any) {
    const code = err && err.code;
    if (code === 'declined') return 'declined';
    if (code === 'rejected_extension') return 'rejected_extension';
    // not_granted / capability_disabled / unavailable e afins: trata como ausente.
    return 'unavailable';
  }
}

/**
 * Detecta se a aplicação roda dentro de um iframe/sandbox. O acesso a
 * window.top pode lançar por política de mesma origem; nesse caso tratamos
 * como incorporado (é o cenário onde o download é bloqueado).
 */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* ignora: cai no retorno false */
  }
  return false;
}

function classicDownloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function embeddedFallbackBlob(blob: Blob, filename: string, textForClipboard?: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  let copied = false;
  if (textForClipboard) copied = await copyToClipboard(textForClipboard);
  const msg = win
    ? `O download direto é bloqueado neste ambiente. O arquivo "${filename}" foi aberto em uma nova aba; use "Salvar como" por lá.${copied ? '\n\nO conteúdo também foi copiado para a área de transferência.' : ''}`
    : copied
      ? `O download direto é bloqueado aqui e a nova aba foi impedida pelo navegador. O conteúdo de "${filename}" foi copiado para a área de transferência; cole em um arquivo e salve.`
      : `O download direto é bloqueado neste ambiente. Abra o sistema em uma aba própria (fora do preview) para baixar "${filename}".`;
  showToast(msg, 'info');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Baixa um Blob. Ordem: API do artefato (quando presente), depois download
 * padrao em pagina de topo, depois nova aba/clipboard em outros embeds.
 */
export async function downloadBlob(
  blob: Blob,
  filename: string,
  textForClipboard?: string
): Promise<void> {
  // 1) API do visualizador de artefato (quando a pagina roda dentro da Claude).
  const claudePresent = typeof (window as any).claude?.use === 'function';
  if (claudePresent) {
    const ext = extOf(filename);
    if (CLAUDE_ALLOWED_EXT.has(ext)) {
      const res = await trySaveViaClaude(filename, blob);
      if (res === 'saved' || res === 'declined') return; // declinou = decisao do usuario
    } else {
      // Extensao nao aceita pela API (ex.: .dxf). Oferece como .txt no preview.
      const alt = filename.replace(/\.[^.]+$/, '') + '.txt';
      const res = await trySaveViaClaude(alt, blob);
      if (res === 'saved') {
        showToast(`Neste preview da Claude o arquivo foi salvo como "${alt}" (a extensão .${ext} não é aceita aqui). Renomeie para .${ext} depois, ou use o sistema publicado para baixar já com a extensão correta.`, 'info');
        return;
      }
      if (res === 'declined') return;
    }
    // Se a API falhou, cai para a nova aba (ultimo recurso dentro do embed).
    await embeddedFallbackBlob(blob, filename, textForClipboard);
    return;
  }

  // 2) Pagina de topo (deploy normal, ex.: Vercel): download padrao.
  if (!isEmbedded()) {
    classicDownloadBlob(blob, filename);
    return;
  }

  // 3) Incorporado sem a API: nova aba / clipboard.
  await embeddedFallbackBlob(blob, filename, textForClipboard);
}

/**
 * Salva um documento jsPDF. Ordem: API do artefato (PDF e aceito), depois
 * doc.save() em pagina de topo, depois nova aba no embed.
 */
export async function savePdfDoc(
  doc: { save: (n: string) => void; output: (t: string, o?: any) => any },
  filename: string
): Promise<void> {
  // 1) API do visualizador de artefato.
  const claudePresent = typeof (window as any).claude?.use === 'function';
  if (claudePresent) {
    let blob: Blob | null = null;
    try { blob = doc.output('blob'); } catch { blob = null; }
    if (blob) {
      const res = await trySaveViaClaude(filename, blob);
      if (res === 'saved' || res === 'declined') return;
    }
    // API falhou: tenta abrir em nova aba.
    try {
      doc.output('dataurlnewwindow', { filename });
      showToast(`O download direto é bloqueado neste ambiente. O PDF "${filename}" foi aberto em nova aba; use "Salvar como", ou abra o sistema fora do preview.`, 'info');
    } catch {
      try { const url = doc.output('bloburl'); window.open(String(url), '_blank'); } catch { /* desiste */ }
    }
    return;
  }

  // 2) Pagina de topo: download padrao do jsPDF.
  if (!isEmbedded()) {
    doc.save(filename);
    return;
  }

  // 3) Incorporado sem a API: nova aba.
  try {
    doc.output('dataurlnewwindow', { filename });
  } catch {
    try {
      const url = doc.output('bloburl');
      window.open(String(url), '_blank');
    } catch {
      doc.save(filename);
    }
  }
  showToast(`O download direto é bloqueado neste ambiente. O PDF "${filename}" foi aberto em nova aba; use "Salvar como" por lá, ou abra o sistema fora do preview.`, 'info');
}
