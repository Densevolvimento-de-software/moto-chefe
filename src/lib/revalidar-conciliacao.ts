import { revalidatePath } from 'next/cache'
import type { AlvoConciliacao } from './conciliacao-alvo'

// O mesmo status de conciliação aparece em várias telas; todas revalidam juntas para nunca divergirem (uma
// dizendo "pendente" e a outra "conciliada"). Com o alvo OS, também o detalhe dela.
export function revalidarTelasDaConciliacao(alvo?: AlvoConciliacao | null) {
  if (alvo?.tipo === 'os') revalidatePath(`/ordens-servico/${alvo.id}`)
  for (const caminho of ['/vendas', '/pecas', '/ordens-servico', '/dashboard', '/conciliacao', '/pix-mcp']) revalidatePath(caminho)
}
