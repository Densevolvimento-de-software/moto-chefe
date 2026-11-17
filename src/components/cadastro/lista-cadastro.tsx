// Pedaços da lista de cadastro de logins (/admin/usuarios e /admin/acessos-fabrica): busca, filtro
// de situação, selo de iniciais e situação Ativo/Inativo. Mesma aparência nas duas telas.
import { Search } from 'lucide-react'
import { iniciaisDoNome } from '@/lib/texto'
import type { Situacao } from '@/lib/usuarios-filtro'

export function SituacaoAtivo({ ativo }: { ativo: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${ativo ? '' : 'text-muted-foreground'}`}>
      <span className={`size-1.5 rounded-full ${ativo ? 'bg-success' : 'bg-input'}`} />{ativo ? 'Ativo' : 'Inativo'}
    </span>
  )
}

export function SeloIniciais({ nome }: { nome: string }) {
  return <span className="grid size-7 shrink-0 place-items-center rounded-sm border bg-muted text-[11px] font-semibold text-muted-foreground">{iniciaisDoNome(nome)}</span>
}

export function BuscaDaLista({ valor, onChange, placeholder, rotulo }: { valor: string; onChange: (v: string) => void; placeholder: string; rotulo: string }) {
  return (
    <label className="flex h-8 w-full items-center gap-2 rounded-md border border-input bg-card px-2 text-muted-foreground sm:w-72">
      <Search size={15} className="shrink-0" />
      <input value={valor} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        aria-label={rotulo} className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
    </label>
  )
}

const ROTULO_SITUACAO: Record<Situacao, string> = { ativos: 'Ativos', inativos: 'Inativos', todos: 'Todos' }

export function FiltroSituacao({ valor, onChange }: { valor: Situacao; onChange: (s: Situacao) => void }) {
  return (
    <div className="flex gap-1" role="group" aria-label="Situação">
      {(['ativos', 'inativos', 'todos'] as const).map(s => (
        <button key={s} type="button" aria-pressed={valor === s} onClick={() => onChange(s)}
          className="h-8 rounded-md border px-2.5 text-sm text-muted-foreground aria-pressed:border-foreground aria-pressed:font-medium aria-pressed:text-foreground">
          {ROTULO_SITUACAO[s]}
        </button>
      ))}
    </div>
  )
}
