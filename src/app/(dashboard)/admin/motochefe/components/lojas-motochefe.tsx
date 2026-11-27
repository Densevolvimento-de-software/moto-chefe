'use client'

// Tela Lojas MotoChefe (#321, variante 2 do protótipo aprovado). Lista de Contas à esquerda; no celular,
// a lista e o painel se alternam. Cada gravação mostra o valor pedido enquanto envia; se a action recusa,
// volta ao valor de antes e diz que nada mudou. Desmarcar e tirar a autorização pedem confirmação.
import { useState } from 'react'
import { Loader2, Store, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { contarMarcadas, resumoDaTela, type ContaDaTela, type LojaDaTela } from '@/lib/motochefe-marcacao'
import { autorizarContaAction, marcarLojaMotochefeAction } from '../actions'
import { ConfirmarDialogo } from './confirmar-dialogo'

type Erro = { chave: string; texto: string; tentar: () => void }
type Confirmacao = { tipo: 'loja'; loja: LojaDaTela } | { tipo: 'conta'; conta: ContaDaTela } | null

const chaveDaLoja = (id: string) => `loja:${id}`
const chaveDaConta = (id: string) => `conta:${id}`

export function LojasMotochefe({ contas }: { contas: ContaDaTela[] }) {
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null)
  // Valor pedido por cada interruptor enquanto a action roda (a chave diz de qual).
  const [enviando, setEnviando] = useState<Record<string, boolean>>({})
  const [erro, setErro] = useState<Erro | null>(null)
  const [confirmacao, setConfirmacao] = useState<Confirmacao>(null)

  const resumo = resumoDaTela(contas)
  const selecionada = contas.find(c => c.id === selecionadaId) ?? null

  async function gravar(chave: string, enviar: () => Promise<{ ok: boolean; erro?: string }>, falha: string) {
    setErro(null)
    setEnviando(e => ({ ...e, [chave]: true }))
    try {
      const r = await enviar()
      if (!r.ok) setErro({ chave, texto: falha, tentar: () => gravar(chave, enviar, falha) })
    } catch {
      setErro({ chave, texto: falha, tentar: () => gravar(chave, enviar, falha) })
    } finally {
      setEnviando(e => ({ ...e, [chave]: false }))
    }
  }

  function mudarLoja(loja: LojaDaTela, marcada: boolean) {
    if (marcada) enviarLoja(loja, true)
    else setConfirmacao({ tipo: 'loja', loja })
  }

  function enviarLoja(loja: LojaDaTela, marcada: boolean) {
    const falha = `Não deu para ${marcada ? 'marcar' : 'desmarcar'} a loja. Nada mudou. Tente de novo.`
    return gravar(chaveDaLoja(loja.id), () => marcarLojaMotochefeAction({ lojaId: loja.id, marcada }), falha)
  }

  function mudarAutorizacao(conta: ContaDaTela, autorizada: boolean) {
    if (autorizada) enviarAutorizacao(conta, true)
    else setConfirmacao({ tipo: 'conta', conta })
  }

  function enviarAutorizacao(conta: ContaDaTela, autorizada: boolean) {
    const falha = 'Não deu para mudar a autorização. Nada mudou. Tente de novo.'
    return gravar(chaveDaConta(conta.id), () => autorizarContaAction({ contaId: conta.id, autorizada }), falha)
  }

  async function confirmar() {
    if (!confirmacao) return
    const c = confirmacao
    await (c.tipo === 'loja' ? enviarLoja(c.loja, false) : enviarAutorizacao(c.conta, false))
    setConfirmacao(null)
  }

  const chaveDoDialogo = confirmacao === null ? null : confirmacao.tipo === 'loja' ? chaveDaLoja(confirmacao.loja.id) : chaveDaConta(confirmacao.conta.id)
  const ocupadoNoDialogo = chaveDoDialogo !== null && enviando[chaveDoDialogo] === true
  const dadosDoDialogo = confirmacao === null ? null : confirmacao.tipo === 'loja'
    ? { titulo: `Desmarcar ${confirmacao.loja.nome}?`, texto: 'Ela sai da API na hora, inclusive do histórico desde 01/2026. Quem consulta deixa de ver as vendas dela.', rotuloEnviar: 'Desmarcar loja' }
    : { titulo: `Tirar a autorização da ${confirmacao.conta.nome}?`, texto: 'Custo, despesas e meta das lojas dela saem da API na hora. Venda de moto, peça e OS continuam saindo.', rotuloEnviar: 'Tirar autorização' }

  return (
    <div className="space-y-6">
      <Card data-resumo className="grid gap-0 p-0 md:grid-cols-3 md:divide-x">
        <Resumo titulo="Lojas marcadas" valor={`${resumo.lojasMarcadas} de ${resumo.lojasTotal}`} />
        <Resumo titulo="Contas com loja marcada" valor={`${resumo.contasComMarcada} de ${resumo.contasTotal}`} />
        <Resumo titulo="Contas autorizadas para custo, despesas e meta" valor={`${resumo.contasAutorizadas} de ${resumo.contasTotal}`} />
      </Card>

      {resumo.lojasMarcadas === 0 && (
        <Card className="items-center p-6 text-center">
          <div className="bg-muted text-muted-foreground mx-auto flex size-10 items-center justify-center rounded-lg">
            <Store className="size-5" aria-hidden />
          </div>
          <strong>Nenhuma loja marcada</strong>
          <p className="text-muted-foreground text-sm">
            A API não devolve nenhuma loja até você marcar a primeira. Marque só as lojas da MotoChefe Brasil.
          </p>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(240px,320px)_1fr]">
        <Card className={selecionada ? 'hidden md:flex' : 'flex'}>
          <div className="space-y-1 px-4">
            <h2 className="font-semibold">Contas</h2>
            <p className="text-muted-foreground text-sm">Clique numa Conta para ver as lojas.</p>
          </div>
          <ul className="divide-y">
            {contas.map(conta => {
              const marcadas = contarMarcadas(conta.lojas)
              const ativa = conta.id === selecionadaId
              return (
                <li key={conta.id}>
                  <button
                    type="button"
                    aria-current={ativa ? 'true' : undefined}
                    onClick={() => setSelecionadaId(conta.id)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${ativa ? 'bg-primary-soft' : 'hover:bg-muted'}`}
                  >
                    <span className="space-y-0.5">
                      <strong className="block">{conta.nome}</strong>
                      <span className="text-muted-foreground block text-sm">
                        {conta.lojas.length === 0 ? 'Sem lojas' : `${marcadas} de ${conta.lojas.length} lojas marcadas`}
                      </span>
                    </span>
                    {conta.autorizada
                      ? <Badge className="bg-primary-soft text-primary-text">Autorizada</Badge>
                      : <Badge variant="secondary">Sem autorização</Badge>}
                  </button>
                </li>
              )
            })}
            {contas.length === 0 && <li className="text-muted-foreground px-4 py-3 text-sm">Nenhuma Conta ativa.</li>}
          </ul>
        </Card>

        <div className={`min-w-0 space-y-4 ${selecionada ? '' : 'hidden md:block'}`}>
          {selecionada ? (
            <>
              <Button type="button" variant="ghost" className="md:hidden" onClick={() => setSelecionadaId(null)}>
                Todas as Contas
              </Button>
              <Card className="gap-3">
                <div className="px-4">
                  <h2 className="font-semibold">Custo, despesas e meta</h2>
                  <p className="text-muted-foreground text-sm">{selecionada.nome}</p>
                </div>
                {erro?.chave === chaveDaConta(selecionada.id) && <MensagemDeErro texto={erro.texto} onTentar={erro.tentar} />}
                <div className="flex flex-wrap items-center justify-between gap-4 border-t px-4 pt-3">
                  <p className="text-muted-foreground max-w-prose text-sm">
                    Custo de compra, despesas e meta. Sem autorização, as lojas marcadas saem sem custo e sem linhas de despesa e meta.
                    Venda de moto, peça e OS saem normal.
                  </p>
                  <Interruptor
                    chave={chaveDaConta(selecionada.id)}
                    checado={selecionada.autorizada}
                    enviando={enviando}
                    rotuloAcessivel={`Autorizar custo, despesas e meta: ${selecionada.nome}`}
                    rotulos={{ ligado: 'Autorizada', desligado: 'Sem autorização' }}
                    onMudar={v => mudarAutorizacao(selecionada, v)}
                  />
                </div>
                
              </Card>

              <Card className="gap-3">
                <div className="flex items-center justify-between gap-3 px-4">
                  <h2 className="font-semibold">Lojas da {selecionada.nome}</h2>
                  <span className="text-muted-foreground text-sm">
                    {contarMarcadas(selecionada.lojas)} de {selecionada.lojas.length} lojas marcadas
                  </span>
                </div>
                {selecionada.lojas.length === 0 && <p className="text-muted-foreground px-4 text-sm">Esta Conta ainda não tem lojas.</p>}
                <ul className="divide-y border-t">
                  {selecionada.lojas.map(loja => (
                    <li key={loja.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${loja.ativa ? '' : 'text-muted-foreground'}`}>
                      {erro?.chave === chaveDaLoja(loja.id) && <MensagemDeErro texto={erro.texto} onTentar={erro.tentar} />}
                      <div className="min-w-0 space-y-1">
                        <strong className="block">{loja.nome}</strong>
                        <span className="text-muted-foreground block text-sm">{loja.cidade}</span>
                        {loja.ativa
                          ? <Badge className="bg-success/15 text-success">Ativa</Badge>
                          : <Badge variant="secondary">Inativa</Badge>}
                      </div>
                      <Interruptor
                        chave={chaveDaLoja(loja.id)}
                        checado={loja.marcada}
                        enviando={enviando}
                        rotuloAcessivel={`Loja MotoChefe: ${loja.nome}`}
                        rotulos={{ ligado: 'Marcada', desligado: 'Desmarcada' }}
                        onMudar={v => mudarLoja(loja, v)}
                      />
                      
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          ) : (
            <p className="text-muted-foreground hidden text-sm md:block">Escolha uma Conta à esquerda para ver as lojas e a autorização.</p>
          )}
        </div>
      </div>

      {dadosDoDialogo && (
        <ConfirmarDialogo
          titulo={dadosDoDialogo.titulo}
          texto={dadosDoDialogo.texto}
          rotuloEnviar={dadosDoDialogo.rotuloEnviar}
          ocupado={ocupadoNoDialogo}
          onCancelar={() => setConfirmacao(null)}
          onConfirmar={confirmar}
        />
      )}
    </div>
  )
}

// Uma coluna do resumo: no celular ocupa a largura toda, uma embaixo da outra.
function Resumo({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="flex flex-col gap-1 border-t px-4 py-3 first:border-t-0 md:border-t-0">
      <span className="text-muted-foreground text-sm">{titulo}</span>
      <strong className="text-xl">{valor}</strong>
    </div>
  )
}

function Interruptor({ chave, checado, enviando, rotuloAcessivel, rotulos, onMudar }: {
  chave: string
  checado: boolean
  enviando: Record<string, boolean>
  rotuloAcessivel: string
  rotulos: { ligado: string; desligado: string }
  onMudar: (v: boolean) => void
}) {
  const salvando = enviando[chave] === true
  // Enquanto envia, mostra o valor pedido: é o que o usuário acabou de escolher.
  const mostrado = salvando ? !checado : checado
  return (
    <div className="flex items-center gap-2">
      <Switch checked={mostrado} disabled={salvando} onCheckedChange={onMudar} aria-label={rotuloAcessivel} />
      <span className="text-sm">
        {salvando
          ? <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" aria-hidden />Salvando</span>
          : (mostrado ? rotulos.ligado : rotulos.desligado)}
      </span>
    </div>
  )
}

// Erro da gravação: o texto do protótipo, acima da linha, com Tentar de novo (repete a mesma ação).
function MensagemDeErro({ texto, onTentar }: { texto: string; onTentar: () => void }) {
  return (
    <div role="alert" className="bg-destructive/10 text-destructive flex w-full items-start gap-2 rounded-lg px-3 py-2 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-2">
        <p>{texto}</p>
        <Button type="button" variant="outline" size="sm" onClick={onTentar}>Tentar de novo</Button>
      </div>
    </div>
  )
}
