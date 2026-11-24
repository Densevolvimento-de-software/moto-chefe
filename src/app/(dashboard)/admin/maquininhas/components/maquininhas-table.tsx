'use client'
import { useState, useTransition } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { OPERADORAS, nomeOperadora, situacaoDaOperadora, type SituacaoOperadora } from '@/lib/operadoras'
import type { MaquininhaDoCadastro } from '@/lib/maquininhas-admin'
import { criarMaquininhaAction, editarMaquininhaAction, definirMaquininhaAtivaAction } from '../actions'

const AVISO_MANUAL = 'A conciliação desta maquininha é manual: o relatório dela não é importado.'
const FRASE_INTEGRADA = 'Importada pela integração do Mercado Pago.'
const FRASE_SEM_TOKEN = 'Cadastre o token do Mercado Pago em Grupos para importar.'

// Texto da coluna "Conciliação" e aviso (caixa do Editar e title da célula) por situação.
const CONCILIACAO: Record<SituacaoOperadora, { texto: string; aviso?: string }> = {
  relatorio: { texto: 'Importa relatório' },
  integracao: { texto: 'Integração', aviso: FRASE_INTEGRADA },
  integracao_sem_token: { texto: 'Integração sem token', aviso: FRASE_SEM_TOKEN },
  manual: { texto: 'Manual', aviso: AVISO_MANUAL },
}

// Código gravado fora da lista (nome livre) volta ao diálogo como "Outra".
const escolhaDe = (operadora: string) =>
  OPERADORAS.some(o => o.codigo === operadora) ? operadora : 'outra'

function MaquininhaDialog({ onClose, inicial, temCredencialMp }: {
  onClose: () => void; inicial?: MaquininhaDoCadastro; temCredencialMp: boolean
}) {
  const [escolha, setEscolha] = useState(inicial ? escolhaDe(inicial.operadora) : '')
  const [nome, setNome] = useState(inicial?.nome ?? '')
  const [pending, startTransition] = useTransition()
  const situacaoDaEscolha = escolha ? situacaoDaOperadora(escolha, temCredencialMp) : null
  const avisoDaEscolha = situacaoDaEscolha ? CONCILIACAO[situacaoDaEscolha].aviso : undefined

  function trocarEscolha(v: string) {
    // Nome ainda vazio ou igual ao da operadora anterior acompanha a troca.
    const anterior = OPERADORAS.find(o => o.codigo === escolha)?.nome ?? ''
    if (v !== 'outra' && (!nome.trim() || nome === anterior)) setNome(OPERADORAS.find(o => o.codigo === v)?.nome ?? '')
    if (v === 'outra' && nome === anterior) setNome('')
    setEscolha(v)
  }

  function handleSalvar() {
    startTransition(async () => {
      const dados = { escolha, nome }
      const r = inicial ? await editarMaquininhaAction(inicial.id, dados) : await criarMaquininhaAction(dados)
      if (!r.ok) { toast.error(r.erro); return }
      toast.success(inicial ? 'Maquininha atualizada' : 'Maquininha cadastrada')
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{inicial ? 'Editar maquininha' : 'Nova maquininha'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Operadora</Label>
            <select
              value={escolha}
              onChange={e => trocarEscolha(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="" disabled>Escolha a operadora</option>
              {OPERADORAS.map(o => <option key={o.codigo} value={o.codigo}>{o.nome}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label>{escolha === 'outra' ? 'Nome da operadora' : 'Nome na tela'}</Label>
            <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Rede Itaú, Stone da loja…" />
            <p className="text-xs text-muted-foreground">É o nome que o vendedor escolhe no pagamento com cartão.</p>
          </div>
          {avisoDaEscolha && (
            <p className={situacaoDaEscolha === 'integracao'
              ? 'text-sm text-muted-foreground'
              : 'rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning'}>{avisoDaEscolha}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={pending || !escolha || !nome.trim()}>
            {pending ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function MaquininhasTable({ maquininhas, temCredencialMp }: {
  maquininhas: MaquininhaDoCadastro[]; temCredencialMp: boolean
}) {
  const [novaOpen, setNovaOpen] = useState(false)
  const [editando, setEditando] = useState<MaquininhaDoCadastro | null>(null)
  const [pending, startTransition] = useTransition()

  function alternar(m: MaquininhaDoCadastro) {
    startTransition(async () => {
      const r = await definirMaquininhaAtivaAction(m.id, !m.ativo)
      if (!r.ok) { toast.error(r.erro); return }
      toast.success(m.ativo ? 'Maquininha desativada' : 'Maquininha reativada')
    })
  }

  const linhas = maquininhas.map(m => ({ ...m, situacao: situacaoDaOperadora(m.operadora, temCredencialMp) }))

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setNovaOpen(true)}>
          <Plus size={14} /> Nova maquininha
        </Button>
      </div>

      <div className="bg-card rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Maquininha</TableHead>
              <TableHead>Operadora</TableHead>
              <TableHead>Conciliação</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {maquininhas.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                  Nenhuma maquininha cadastrada neste grupo.
                </TableCell>
              </TableRow>
            )}
            {linhas.map(m => (
              <TableRow key={m.id} className={m.ativo ? '' : 'opacity-60'}>
                <TableCell className="font-medium">{m.nome}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{nomeOperadora(m.operadora)}</TableCell>
                <TableCell
                  className={m.situacao === 'integracao_sem_token' ? 'text-sm text-warning' : 'text-sm text-muted-foreground'}
                  title={CONCILIACAO[m.situacao].aviso}
                >
                  {CONCILIACAO[m.situacao].texto}
                </TableCell>
                <TableCell>
                  {m.ativo
                    ? <Badge variant="outline" className="bg-success/10 text-success border-success/30">Ativa</Badge>
                    : <Badge variant="outline" className="bg-muted text-muted-foreground border-border">Inativa</Badge>}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="icon" onClick={() => setEditando(m)} title="Editar">
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => alternar(m)}>
                      {m.ativo ? 'Desativar' : 'Reativar'}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {novaOpen && <MaquininhaDialog onClose={() => setNovaOpen(false)} temCredencialMp={temCredencialMp} />}
      {editando && (
        <MaquininhaDialog key={editando.id} inicial={editando} onClose={() => setEditando(null)} temCredencialMp={temCredencialMp} />
      )}
    </div>
  )
}
