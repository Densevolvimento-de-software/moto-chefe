'use client'
// Tela de acessos da fábrica (#3), variante 3 do protótipo aprovado: o padrão de /admin/usuarios.
// Tabela no computador e no tablet, cartões no celular; clicar num acesso abre o painel lateral
// (tela cheia no celular) com a situação, o desativar/reativar e o trocar senha. Criar também no painel.
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ChevronRight, Factory, UserCheck, UserPlus, UserX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { CampoSenha } from '@/components/auth/campo-senha'
import { BuscaDaLista, FiltroSituacao, SeloIniciais, SituacaoAtivo } from '@/components/cadastro/lista-cadastro'
import { filtrarPorBuscaESituacao, type Situacao } from '@/lib/usuarios-filtro'
import { validarAcessoFabrica } from '@/lib/acessos-fabrica'
import { FRASE_SENHA_CURTA, SENHA_MINIMA, senhaCurta } from '@/lib/senha'
import { plural } from '@/lib/texto'
import { alternarAcessoFabricaAction, criarAcessoFabricaAction, redefinirSenhaFabricaAction } from '../actions'

type Acesso = { id: string; nome: string; email: string; ativo: boolean }

// Erro fora das recusas da action (banco, rede) não pode deixar a tela sem resposta.
const FALHA = 'Não deu para concluir agora. Tente de novo.'
const semExcecao = <T,>(p: Promise<T>) => p.catch(() => ({ ok: false as const, erro: FALHA }))

export function AcessosFabrica({ acessos }: { acessos: Acesso[] }) {
  const [enviando, iniciar] = useTransition()
  const [filtros, setFiltros] = useState<{ busca: string; situacao: Situacao }>({ busca: '', situacao: 'ativos' })
  const [criando, setCriando] = useState(false)
  const [abertoId, setAbertoId] = useState<string | null>(null)
  // Lido da lista a cada render: depois do revalidate, o painel mostra a situação nova.
  const aberto = acessos.find(a => a.id === abertoId) ?? null
  const lista = filtrarPorBuscaESituacao(acessos, filtros, a => [a.nome, a.email])
  const inativos = acessos.filter(a => !a.ativo).length
  const fechar = () => { if (!enviando) { setCriando(false); setAbertoId(null) } }
  const novo = () => { setAbertoId(null); setCriando(true) }
  const abrir = (id: string) => { setCriando(false); setAbertoId(id) }

  return (
    <>
      {acessos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-input bg-card px-5 py-11 text-center">
          <span className="grid size-11 place-items-center rounded-lg bg-muted text-muted-foreground"><Factory size={22} /></span>
          <p className="font-semibold">Nenhum acesso da fábrica ainda</p>
          <p className="max-w-md text-sm text-muted-foreground">Crie o login que a fábrica vai usar para entrar no painel. Você define o e-mail e a senha e passa para ela.</p>
          <Button onClick={novo} className="mt-1.5 gap-2"><UserPlus size={16} /> Novo acesso</Button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <BuscaDaLista valor={filtros.busca} onChange={busca => setFiltros(f => ({ ...f, busca }))} placeholder="Buscar por nome ou e-mail" rotulo="Buscar acesso" />
            <FiltroSituacao valor={filtros.situacao} onChange={situacao => setFiltros(f => ({ ...f, situacao }))} />
            <span className="hidden flex-1 sm:block" />
            <Button onClick={novo} className="w-full gap-2 sm:w-auto"><UserPlus size={16} /> Novo acesso</Button>
          </div>

          {/* Computador e tablet: tabela; clicar na linha abre o painel. */}
          <div className="hidden overflow-hidden rounded-md border bg-card md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Acesso</th>
                  <th className="w-36 px-3 py-2 font-medium">Situação</th>
                  <th className="w-10 px-3 py-2"><span className="sr-only">Abrir</span></th>
                </tr>
              </thead>
              <tbody>
                {lista.map(a => (
                  <tr key={a.id} onClick={() => abrir(a.id)} className={`cursor-pointer border-t hover:bg-muted/60 ${a.id === abertoId ? 'bg-muted/60' : ''}`}>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => abrir(a.id)} className="flex items-center gap-2.5 text-left">
                        <SeloIniciais nome={a.nome} />
                        <span className="min-w-0"><span className="block font-medium">{a.nome}</span><span className="block text-xs text-muted-foreground">{a.email}</span></span>
                      </button>
                    </td>
                    <td className="px-3 py-2"><SituacaoAtivo ativo={a.ativo} /></td>
                    <td className="px-3 py-2 text-right text-muted-foreground"><ChevronRight size={16} className="inline" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              {plural(acessos.length, 'acesso', 'acessos')}, {plural(inativos, 'inativo', 'inativos')}. Clique num acesso para trocar a senha ou desativar.
            </p>
          </div>

          {/* Celular: cartões. */}
          <div className="divide-y rounded-md border bg-card md:hidden">
            {lista.map(a => (
              <button key={a.id} type="button" onClick={() => abrir(a.id)} className="flex w-full items-center gap-2.5 px-3 py-3 text-left">
                <SeloIniciais nome={a.nome} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{a.nome}</span>
                  <span className="block truncate text-xs text-muted-foreground">{a.email}</span>
                  <span className="mt-1 block"><SituacaoAtivo ativo={a.ativo} /></span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
          {lista.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nenhum acesso com esses filtros.</p>}
        </>
      )}

      {/* Painel lateral de criar e do acesso; no celular ocupa a tela. */}
      <Sheet open={criando || !!aberto} onOpenChange={o => { if (!o) fechar() }}>
        <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
          {criando && <PainelCriar enviando={enviando} iniciar={iniciar} onFechar={fechar} onCriado={() => setCriando(false)} />}
          {!criando && aberto && <PainelAcesso key={aberto.id} acesso={aberto} enviando={enviando} iniciar={iniciar} onFechar={fechar} />}
        </SheetContent>
      </Sheet>
    </>
  )
}

type Envio = { enviando: boolean; iniciar: (fn: () => Promise<void>) => void; onFechar: () => void }

function PainelCriar({ enviando, iniciar, onFechar, onCriado }: Envio & { onCriado: () => void }) {
  const [novo, setNovo] = useState({ nome: '', email: '', senha: '' })
  const criar = () => {
    const v = validarAcessoFabrica(novo)
    if (!v.ok) { toast.error(v.erro); return }
    iniciar(async () => {
      const r = await semExcecao(criarAcessoFabricaAction(v.dados))
      if (!r.ok) { toast.error(r.erro); return }
      toast.success(`Acesso criado. Passe à fábrica o e-mail ${v.dados.email} e a senha definida.`)
      onCriado()
    })
  }
  return (
    <form className="flex h-full flex-col" onSubmit={e => { e.preventDefault(); criar() }}>
      <SheetHeader className="border-b pr-12">
        <SheetTitle>Novo acesso</SheetTitle>
      </SheetHeader>
      <div className="space-y-3 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="fab-nome">Nome</Label>
          <Input id="fab-nome" value={novo.nome} onChange={e => setNovo(p => ({ ...p, nome: e.target.value }))} placeholder="Ex.: Fábrica Comercial" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fab-email">E-mail do login</Label>
          <Input id="fab-email" type="email" value={novo.email} onChange={e => setNovo(p => ({ ...p, email: e.target.value }))} autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fab-senha">Senha</Label>
          <CampoSenha id="fab-senha" value={novo.senha} onChange={e => setNovo(p => ({ ...p, senha: e.target.value }))} autoComplete="new-password" />
          <p className="text-xs text-muted-foreground">Pelo menos {SENHA_MINIMA} caracteres. A fábrica não troca a própria senha: quem troca é você.</p>
        </div>
      </div>
      <SheetFooter className="flex-row justify-end border-t">
        <Button type="button" variant="outline" onClick={onFechar} disabled={enviando}>Cancelar</Button>
        <Button type="submit" disabled={enviando}>{enviando ? 'Salvando…' : 'Criar acesso'}</Button>
      </SheetFooter>
    </form>
  )
}

function PainelAcesso({ acesso: a, enviando, iniciar, onFechar }: Envio & { acesso: Acesso }) {
  const [novaSenha, setNovaSenha] = useState('')
  const alternar = () => iniciar(async () => {
    const r = await semExcecao(alternarAcessoFabricaAction(a.id, !a.ativo))
    if (!r.ok) toast.error(r.erro)
    else toast.success(a.ativo ? `${a.nome} não entra mais` : `${a.nome} voltou a entrar`)
  })
  const trocarSenha = () => {
    if (senhaCurta(novaSenha)) { toast.error(FRASE_SENHA_CURTA); return }
    iniciar(async () => {
      const r = await semExcecao(redefinirSenhaFabricaAction(a.id, novaSenha))
      if (!r.ok) { toast.error(r.erro); return }
      toast.success(`Senha de ${a.nome} trocada`)
      setNovaSenha('')
    })
  }
  return (
    <form className="flex h-full flex-col" onSubmit={e => { e.preventDefault(); trocarSenha() }}>
      <SheetHeader className="border-b pr-12">
        <div className="flex items-center gap-2.5">
          <SeloIniciais nome={a.nome} />
          <div className="min-w-0">
            <SheetTitle className="truncate">{a.nome}</SheetTitle>
            <SheetDescription className="truncate text-xs">{a.email}</SheetDescription>
          </div>
        </div>
      </SheetHeader>
      <section className="space-y-2 border-b p-4">
        <h3 className="text-sm font-semibold">Situação</h3>
        <div className="flex items-center justify-between gap-3">
          <SituacaoAtivo ativo={a.ativo} />
          <Button type="button" variant="outline" size="sm" onClick={alternar} disabled={enviando} className={`gap-1.5 ${a.ativo ? 'text-destructive' : ''}`}>
            {a.ativo ? <UserX size={14} /> : <UserCheck size={14} />}{a.ativo ? 'Desativar' : 'Reativar'}
          </Button>
        </div>
      </section>
      <section className="space-y-1.5 p-4">
        <h3 className="text-sm font-semibold">Trocar senha</h3>
        <p className="text-xs text-muted-foreground">A fábrica não troca a própria senha. Defina uma nova e passe para ela.</p>
        <Label htmlFor={`senha-${a.id}`} className="pt-1.5">Nova senha</Label>
        <CampoSenha id={`senha-${a.id}`} value={novaSenha} onChange={e => setNovaSenha(e.target.value)} autoComplete="new-password" />
        <p className="text-xs text-muted-foreground">Pelo menos {SENHA_MINIMA} caracteres. Vale no próximo login da fábrica.</p>
      </section>
      <SheetFooter className="flex-row justify-end border-t">
        <Button type="button" variant="outline" onClick={onFechar} disabled={enviando}>Fechar</Button>
        <Button type="submit" disabled={enviando}>Salvar senha</Button>
      </SheetFooter>
    </form>
  )
}
