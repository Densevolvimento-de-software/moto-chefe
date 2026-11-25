// Folha do certificado do seguro de bateria, edição 2026 (MAPFRE, apólice 3008000014551): A4 em pontos, como o PDF
// da MotoChefe. Layout da variante A aprovada no protótipo da #235. Cor só por variável do globals.css: o preto do
// papel é o --foreground e o fundo do quadro de dados é o --muted. As fontes (--font-montserrat, --font-hanken,
// --font-open-sans) vêm da página, que é quem carrega com next/font.
import { rotuloDocumento } from '@/lib/documento'

export type DadosDoCertificado = {
  clienteNome: string
  clienteCpf: string
  notaFiscalSaida: string | null
  marca: string
  modelo: string
  cor: string
  lojaNome: string
}

const TEXTO = {
  oferta: 'MOTOCHEFE OFERECE GARANTIA PARA SUAS BATERIAS, COM COBERTURA PARA INDENIZAÇÃO POR EVENTUAIS DANOS, OBSERVADOS OS LIMITES E CONDIÇÕES ESTABELECIDOS NO TERMO DE COBERTURA.',
  apolice: 'ESTA COBERTURA É GARANTIDA PELA MAPFRE SEGURADORA, POR MEIO DA APÓLICE Nº 3008000014551, VÁLIDA EM TERRITÓRIO NACIONAL, CONFORME OS TERMOS E CONDIÇÕES ESTABELECIDOS NO CONTRATO DE SEGURO.',
  condicoes: 'ESTE CERTIFICADO ASSEGURA AO CONSUMIDOR A COBERTURA PARA INDENIZAÇÃO POR EVENTUAIS DANOS OCASIONADOS POR DEFEITO/VÍCIO DE FABRICAÇÃO DEVIDAMENTE CONSTATADO, CONFORME OS LIMITES E CONDIÇÕES PREVISTOS NO TERMO DE COBERTURA. A REIVINDICAÇÃO DOS TERMOS DESTE CERTIFICADO DE GARANTIA PELO CONSUMIDOR SERÁ CONDICIONADA MEDIANTE APRESENTAÇÃO DA NOTA FISCAL, DESTE CERTIFICADO, E COMPROVADAS AS RAZÕES DE SUA APLICAÇÃO EM OBEDIÊNCIA AS CONDIÇÕES PREVISTAS.',
  rescisao: 'A MOTOCHEFE RESERVA-SE O DIREITO DE RESCINDIR A COBERTURA A QUALQUER MOMENTO, EM CONFORMIDADE COM CONDIÇÕES PREVISTAS NO TERMO. O ENCERRAMENTO PODERÁ OCORRER MEDIANTE COMUNICAÇÃO POR AVISO PUBLICADO NO SITE OFICIAL DA EMPRESA.',
}

const ESTILO = `
  @page { size: A4; margin: 0; }
  .cert-folha { position: relative; width: 595.5pt; height: 842.25pt; margin: 0 auto; background: var(--card); color: var(--foreground); overflow: hidden; }
  .cert-folha * { box-sizing: border-box; margin: 0; padding: 0; }
  .cert-moldura { position: absolute; left: 20pt; top: 21pt; width: 553pt; height: 797pt; border: 2pt solid var(--foreground); }
  .cert-titulo, .cert-card h2 { font-family: var(--font-montserrat), var(--font-open-sans), sans-serif; font-weight: 800; }
  .cert-hanken { font-family: var(--font-hanken), var(--font-open-sans), sans-serif; }
  .cert-abs { position: absolute; }
  .cert-centro { left: 0; right: 0; text-align: center; }
  .cert-titulo { top: 30pt; font-size: 41pt; line-height: 1; letter-spacing: .01em; }
  .cert-subtitulo { top: 85pt; font-size: 30pt; font-weight: 700; line-height: 1.1; }
  .cert-logo { left: 145pt; top: 136pt; width: 265pt; }
  .cert-selo { left: 424pt; top: 136pt; width: 105pt; }
  .cert-lema { top: 238pt; font-size: 17.9pt; font-weight: 700; line-height: 1.2; }
  .cert-marca-dagua { left: -42pt; top: -10pt; width: 440pt; opacity: .05; }
  .cert-miolo { position: absolute; left: 32pt; top: 288pt; width: 488pt; bottom: 0; display: flex; flex-direction: column; }
  .cert-par { font-size: 12.9pt; line-height: 17.5pt; text-align: justify; letter-spacing: .02em; }
  .cert-esp { flex: 0 1 17pt; min-height: 4pt; }
  .cert-esp-card { flex: 0 1 24pt; min-height: 4pt; }
  .cert-esp-pequeno { flex: 0 1 11pt; min-height: 3pt; }
  .cert-esp-rodape { flex: 1 1 8pt; min-height: 2pt; }
  .cert-card { background: var(--muted); border-radius: 14pt; padding: 9pt 14pt 10pt; flex: 0 0 auto; }
  .cert-card h2 { font-size: 14.2pt; text-align: center; margin-bottom: 4pt; }
  .cert-linha { display: flex; align-items: flex-end; gap: 6pt; font-size: 11.2pt; line-height: 15.3pt; min-height: 18pt; font-family: var(--font-open-sans), sans-serif; }
  .cert-rot { font-weight: 700; white-space: nowrap; }
  .cert-val { flex: 1 1 0; min-width: 0; border-bottom: .75pt solid var(--foreground); padding: 0 3pt; overflow-wrap: anywhere; min-height: 15.3pt; }
  .cert-val.cert-doc { flex: 0 0 169pt; }
  .cert-nasc { margin-left: 6pt; }
  .cert-peq { font-size: 7.9pt; line-height: 10.3pt; text-align: justify; letter-spacing: .02em; }
  .cert-rodape { display: flex; align-items: center; gap: 14pt; margin: 0 auto; padding-bottom: 24pt; }
  .cert-rodape img { width: 79pt; }
  .cert-contato { font-family: var(--font-open-sans), sans-serif; font-size: 10pt; line-height: 11pt; letter-spacing: .1em; }
`

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return <div className="cert-linha"><span className="cert-rot">{rotulo}:</span><span className="cert-val">{valor}</span></div>
}

export function FolhaCertificadoBateria({ venda }: { venda: DadosDoCertificado }) {
  return (
    <>
      <style>{ESTILO}</style>
      <div className="cert-folha">
        <div className="cert-moldura">
          {/* eslint-disable @next/next/no-img-element -- papel de impressão: a imagem tem de estar carregada quando a janela abre */}
          <img className="cert-abs cert-marca-dagua" src="/brand/motochefe-icone-mc.png" alt="" />
          <div className="cert-abs cert-centro cert-titulo">CERTIFICADO</div>
          <div className="cert-abs cert-centro cert-subtitulo cert-hanken">SEGURO EXCLUSIVO BATERIAS</div>
          <img className="cert-abs cert-logo" src="/brand/motochefe-logo-certificado.png" alt="MotoChefe" />
          <img className="cert-abs cert-selo" src="/brand/motochefe-selo-seguro-bateria.png" alt="Selo de garantia MotoChefe, seguro exclusivo MAPFRE" />
          <div className="cert-abs cert-centro cert-lema cert-hanken">PRIMEIRO SEGURO DE BATERIA,<br />GARANTIA QUE VAI ALÉM!</div>
          <div className="cert-miolo cert-hanken">
            <p className="cert-par">{TEXTO.oferta}</p>
            <div className="cert-esp" />
            <p className="cert-par">{TEXTO.apolice}</p>
            <div className="cert-esp-card" />
            <div className="cert-card">
              <h2>DADOS DO ASSEGURADO</h2>
              <Linha rotulo="NOME COMPLETO" valor={venda.clienteNome} />
              <div className="cert-linha">
                <span className="cert-rot">{rotuloDocumento(venda.clienteCpf)}:</span><span className="cert-val cert-doc">{venda.clienteCpf}</span>
                <span className="cert-rot cert-nasc">DATA DE NASCIMENTO:</span><span className="cert-val"></span>
              </div>
              <Linha rotulo="Nº DA NOTA FISCAL" valor={venda.notaFiscalSaida ?? ''} />
              <Linha rotulo="MODELO DO VEÍCULO" valor={`${venda.marca} ${venda.modelo}`} />
              <Linha rotulo="COR DO VEÍCULO" valor={venda.cor} />
              <Linha rotulo="Nº ID BATERIA" valor="" />
              <Linha rotulo="UNIDADE DE VENDA" valor={venda.lojaNome} />
            </div>
            <div className="cert-esp-pequeno" />
            <p className="cert-peq">{TEXTO.condicoes}<br />{TEXTO.rescisao}</p>
            <div className="cert-esp-rodape" />
            <div className="cert-rodape">
              <img src="/brand/motochefe-icone-mc.png" alt="MC" />
              <div className="cert-contato">SAC (21) 96679-0202<br />MOTOCHEFEBRASIL.COM.BR<br />@MOTOCHEFEBRASIL</div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
