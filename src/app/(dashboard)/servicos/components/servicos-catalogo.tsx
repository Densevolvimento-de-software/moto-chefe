import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { buttonVariants } from '@/components/ui/button'
import { Plus, Pencil } from 'lucide-react'
import { ServicoForm } from './servico-form'
import { ServicoAtivoToggle } from './servico-ativo-toggle'

export type ServicoLinha = {
  id: string
  nome: string
  tempoPrevistoMinutos: number | null
  valor: string
  ativo: boolean
}

// A tela usa a mesma regra de gestão das actions.
export function ServicosCatalogo({ servicos, podeGerir }: { servicos: ServicoLinha[]; podeGerir: boolean }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Catálogo de Serviços</h1>
          <p className="text-muted-foreground text-sm">Serviços disponíveis para uso em Ordens de Serviço</p>
        </div>
        {podeGerir && (
          <ServicoForm trigger={
            <span className={buttonVariants({ variant: 'default', size: 'sm' })}>
              <Plus size={15} className="mr-1.5" /> Novo Serviço
            </span>
          } />
        )}
      </div>

      <div className="bg-card rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tempo previsto</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {servicos.map(s => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.nome}</TableCell>
                <TableCell>{s.tempoPrevistoMinutos ? `${s.tempoPrevistoMinutos} min` : 'Não informado'}</TableCell>
                <TableCell>
                  {parseFloat(s.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </TableCell>
                <TableCell>
                  <ServicoAtivoToggle id={s.id} ativo={s.ativo} podeGerir={podeGerir} />
                </TableCell>
                <TableCell>
                  {podeGerir && (
                    <ServicoForm
                      servicoInicial={{ id: s.id, nome: s.nome, tempoPrevistoMinutos: s.tempoPrevistoMinutos, valor: s.valor }}
                      trigger={
                        <button className="text-muted-foreground hover:text-foreground">
                          <Pencil size={14} />
                        </button>
                      }
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
            {servicos.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  Nenhum serviço cadastrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
