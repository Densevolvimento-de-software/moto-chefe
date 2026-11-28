'use client'
// Tela da chave da API MotoChefe Brasil (#322, protótipo variante 1 aprovado). A chave nova aparece uma vez, num bloco
// desta tela, e fica só no estado do componente: some ao navegar e não vai para a URL nem para o armazenamento do navegador.
// O componente é o mesmo antes e depois de gerar: a atualização da página não o desmonta, então a chave segue na tela.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, Copy, KeyRound, Loader2, Plus, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FRASE_CHAVE_TROCADA_AGORA, FRASE_JA_TEM_CHAVE, FRASE_SEM_CHAVE } from '@/lib/api-leitura'
import { dataHoraBrt, horasQueFaltam, progressoDoPrazo, textoDaTroca, textoFaltam } from '@/lib/chave-da-tela'
import type { SituacaoDaChave } from '@/lib/queries/api-leitura'
import type { ResultadoAction } from '@/lib/resultado-action'
import { gerarChaveAction, revogarChaveAction, trocarChaveAction } from '../actions'
import { ConfirmarDialogo } from '../../components/confirmar-dialogo'
import { MensagemDeErro } from '../../components/interruptor'

type Pedido = 'gerar' | 'trocar' | 'revogar'
type Resultado = { ok: true; chave?: string } | { ok: false; erro: string }
// As actions devolvem { ok, dados }; a tela só precisa da chave (se houver) ou da frase.
const deGravacao = (r: ResultadoAction<{ chave: string }>): Resultado => (r.ok ? { ok: true, chave: r.dados.chave } : { ok: false, erro: r.erro })
const deRevogacao = (r: ResultadoAction): Resultado => (r.ok ? { ok: true } : { ok: false, erro: r.erro })
type Erro = { texto: string; pedido: Pedido; recarregar: boolean }

// Frases que pedem a tela atualizada, não outra tentativa da mesma ação.
const FRASES_DE_RECARREGAR: string[] = [FRASE_JA_TEM_CHAVE, FRASE_SEM_CHAVE, FRASE_CHAVE_TROCADA_AGORA]
const FRASE_DE_FALHA = 'Não deu para concluir. Tente de novo.'
const MASCARA = '••••••••••••••••••••••••••••••••'

export function ChaveDaApi({ situacao, agora }: { situacao: SituacaoDaChave; agora: Date }) {
  const router = useRouter()
  const [chaveNova, setChaveNova] = useState<string | null>(null)
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [erro, setErro] = useState<Erro | null>(null)
  const [confirmacao, setConfirmacao] = useState<'trocar' | 'revogar' | null>(null)
  const [copia, setCopia] = useState<'copiada' | 'falhou' | null>(null)
  const enviando = pedido !== null

  async function enviar(p: Pedido, chamar: () => Promise<Resultado>) {
    setErro(null)
    setPedido(p)
    let r: Resultado
    try {
      r = await chamar()
    } catch {
      r = { ok: false, erro: FRASE_DE_FALHA }
    }
    setPedido(null)
    setConfirmacao(null)
    if (r.ok) {
      // Gerar e trocar mostram a chave nova; revogar a tira, porque ela não vale mais.
      setCopia(null)
      setChaveNova(r.chave ?? null)
      return
    }
    setErro({ texto: r.erro, pedido: p, recarregar: FRASES_DE_RECARREGAR.includes(r.erro) })
  }

  // A frase de recarregar não repete a ação: a tela atualizada é que resolve.
  function tentarDeNovo(e: Erro) {
    setErro(null)
    if (e.pedido === 'trocar') setConfirmacao('trocar')
    else if (e.pedido === 'revogar') setConfirmacao('revogar')
    else void enviar('gerar', async () => deGravacao(await gerarChaveAction()))
  }

  async function copiar() {
    if (!chaveNova) return
    try {
      await navigator.clipboard.writeText(chaveNova)
      setCopia('copiada')
    } catch {
      setCopia('falhou')
    }
  }

  const atual = situacao.atual
  const anterior = situacao.anterior

  return (
    <div className="space-y-4">
      {erro && (
        <MensagemDeErro
          texto={erro.texto}
          rotulo={erro.recarregar ? 'Recarregar a página' : 'Tentar de novo'}
          onTentar={() => (erro.recarregar ? router.refresh() : tentarDeNovo(erro))}
        />
      )}

      {chaveNova && (
        <Card className="gap-3">
          <div className="px-4">
            <h2 className="font-semibold">Chave nova</h2>
            <p className="text-muted-foreground text-sm">Esta é a única vez que a chave aparece. Copie e guarde agora.</p>
          </div>
          <p className="bg-muted mx-4 break-all rounded-md px-3 py-2 font-mono text-sm select-all">{chaveNova}</p>
          <div className="px-4">
            <Button type="button" variant="outline" onClick={copiar}>
              <Copy className="size-4" aria-hidden />
              Copiar chave
            </Button>
          </div>
          {copia && (
            <p role="status" className="px-4 text-sm">
              {copia === 'copiada' ? 'Chave copiada.' : 'Não deu para copiar. Selecione a chave e copie à mão.'}
            </p>
          )}
        </Card>
      )}

      {atual ? (
        <Card className="gap-3">
          <div className="flex items-center justify-between gap-3 px-4">
            <h2 className="font-semibold">Chave atual</h2>
            <Badge className="bg-success/15 text-success">Ativa</Badge>
          </div>
          <p className="bg-muted mx-4 rounded-md px-3 py-2 font-mono text-sm">{MASCARA}</p>
          <p className="text-muted-foreground px-4 text-sm">
            A chave inteira aparece uma vez, na hora em que é gerada. Depois disso, ela não fica visível aqui.
          </p>
          <dl className="grid gap-3 px-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fato rotulo="Gerada em" valor={dataHoraBrt(atual.geradaEm)} />
            <Fato rotulo="Gerada por" valor={atual.geradaPor ?? 'Usuário não encontrado'} />
            <Fato rotulo="Último uso" valor={atual.ultimoUso ? dataHoraBrt(atual.ultimoUso) : 'Ainda não foi usada'} />
            <Fato rotulo="Limite" valor={`${situacao.limitePorMinuto} chamadas por minuto`} />
          </dl>
          <div className="flex flex-wrap gap-2 px-4">
            <Button type="button" variant="outline" disabled={enviando} onClick={() => setConfirmacao('trocar')}>
              <RefreshCw className="size-4" aria-hidden />
              Trocar chave
            </Button>
            <Button type="button" variant="outline" className="text-destructive" disabled={enviando} onClick={() => setConfirmacao('revogar')}>
              <Ban className="size-4" aria-hidden />
              Revogar chave
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="items-center p-6 text-center">
          <div className="bg-muted text-muted-foreground mx-auto flex size-10 items-center justify-center rounded-lg">
            <KeyRound className="size-5" aria-hidden />
          </div>
          <strong>Nenhuma chave gerada</strong>
          <p className="text-muted-foreground text-sm">
            A API não aceita nenhuma chamada enquanto não houver chave. Gere uma e entregue à MotoChefe Brasil.
          </p>
          <Button type="button" disabled={enviando} onClick={() => enviar('gerar', async () => deGravacao(await gerarChaveAction()))}>
            {pedido === 'gerar' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            {pedido === 'gerar' ? 'Gerando chave' : 'Gerar chave'}
          </Button>
        </Card>
      )}

      {atual && anterior && (
        <Card className="gap-3">
          <div className="flex items-center justify-between gap-3 px-4">
            <h2 className="font-semibold">Chave anterior</h2>
            <Badge className="bg-warning/15 text-warning">Vale até {dataHoraBrt(anterior.validaAte)}</Badge>
          </div>
          <p className="text-muted-foreground px-4 text-sm">
            Ela ainda funciona durante 24 horas depois da troca, para a integração trocar sem parar. Depois disso, só a chave atual funciona.
          </p>
          <div className="px-4">
            <div
              role="img"
              aria-label={`${progressoDoPrazo(anterior.validaAte, agora)}% do prazo já passou`}
              className="bg-muted h-2 overflow-hidden rounded-full"
            >
              <span className="bg-warning block h-full" style={{ width: `${progressoDoPrazo(anterior.validaAte, agora)}%` }} />
            </div>
          </div>
          <p className="flex justify-end px-4 text-sm">{textoFaltam(horasQueFaltam(anterior.validaAte, agora))}</p>
        </Card>
      )}

      <Card className="gap-1">
        <h2 className="px-4 font-semibold">Registro de acesso</h2>
        <p className="text-muted-foreground px-4 text-sm">
          Cada chamada fica guardada por 12 meses: data, o que foi consultado, período, IP e resultado. Nesta fatia não há tela para ver o registro.
        </p>
      </Card>

      {enviando && <p role="status" className="text-muted-foreground text-sm">Espere terminar. Não feche a tela.</p>}

      {confirmacao === 'trocar' && (
        <ConfirmarDialogo
          titulo="Trocar a chave?"
          texto={textoDaTroca(anterior?.validaAte ?? null)}
          rotuloEnviar="Trocar chave"
          ocupado={enviando}
          onCancelar={() => setConfirmacao(null)}
          onConfirmar={() => enviar('trocar', async () => deGravacao(await trocarChaveAction()))}
        />
      )}
      {confirmacao === 'revogar' && (
        <ConfirmarDialogo
          titulo="Revogar a chave agora?"
          texto="A integração da MotoChefe Brasil para na hora. Para voltar, é preciso gerar outra chave e entregar de novo."
          rotuloEnviar="Revogar chave"
          ocupado={enviando}
          onCancelar={() => setConfirmacao(null)}
          onConfirmar={() => enviar('revogar', async () => deRevogacao(await revogarChaveAction()))}
        />
      )}
    </div>
  )
}

function Fato({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-sm">{rotulo}</dt>
      <dd className="font-medium">{valor}</dd>
    </div>
  )
}

