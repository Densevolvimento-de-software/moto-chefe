import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { clientes, lojas, motos, ordensServico, usuarios } from '@/lib/db/schema'
import { clientesDoEscopo, contaDaLoja, lojasDoEscopo } from '@/lib/conta'
import { RecusaUsuario } from '@/lib/resultado-action'
import { usuarioDoEscopo } from '@/lib/usuarios-do-grupo'

type Executor = Pick<typeof db, 'select'>

// Gravação que liga um registro a loja, moto, cliente, OS ou mecânico confere que eles são da
// mesma Conta da loja do registro. O id vem do navegador; de outra Conta, ele "não existe".
// Na persona do admin_rede (#517), `grupoLiberado` restringe tudo ao grupo liberado.
export async function conferirVinculosDaConta(
  lojaId: string,
  vinculos: { novaLojaId?: string; motoId?: string | null; clienteId?: string | null; osId?: string | null; mecanicoId?: string | null },
  grupoLiberado: string | null,
  exec: Executor = db,
): Promise<void> {
  const contaId = await contaDaLoja(lojaId, exec)
  const escopo = { contaId, grupoLiberado }

  if (vinculos.novaLojaId) {
    const [loja] = await exec.select({ id: lojas.id }).from(lojas)
      .where(and(eq(lojas.id, vinculos.novaLojaId), inArray(lojas.id, lojasDoEscopo(escopo)))).limit(1)
    if (!loja) throw new RecusaUsuario('Loja não encontrada')
  }

  if (vinculos.motoId) {
    const [moto] = await exec.select({ id: motos.id }).from(motos)
      .where(and(eq(motos.id, vinculos.motoId), inArray(motos.lojaId, lojasDoEscopo(escopo)))).limit(1)
    if (!moto) throw new RecusaUsuario('Moto não encontrada')
  }

  if (vinculos.clienteId) {
    const [cliente] = await exec.select({ id: clientes.id }).from(clientes)
      .where(and(eq(clientes.id, vinculos.clienteId), clientesDoEscopo(contaId, escopo))).limit(1)
    if (!cliente) throw new RecusaUsuario('Cliente não encontrado')
  }

  if (vinculos.osId) {
    const [os] = await exec.select({ id: ordensServico.id }).from(ordensServico)
      .where(and(eq(ordensServico.id, vinculos.osId), inArray(ordensServico.lojaId, lojasDoEscopo(escopo)))).limit(1)
    if (!os) throw new RecusaUsuario('OS não encontrada')
  }

  if (vinculos.mecanicoId && !(await mecanicoNoEscopo(escopo, vinculos.mecanicoId, exec))) {
    throw new RecusaUsuario(MECANICO_NAO_ENCONTRADO)
  }
}

export const MECANICO_NAO_ENCONTRADO = 'Mecânico não encontrado'

async function mecanicoNoEscopo(escopo: { contaId: string; grupoLiberado: string | null }, mecanicoId: string, exec: Executor) {
  const [mecanico] = await exec.select({ nome: usuarios.nome }).from(usuarios)
    .where(and(eq(usuarios.id, mecanicoId), usuarioDoEscopo(escopo))).limit(1)
  return mecanico ?? null
}

// Mecânico que um registro da loja pode ligar, com o nome para o histórico: o da Conta da loja (ou do
// grupo liberado, na persona). null para outra Conta e para id inexistente, que recebem a mesma frase.
export async function mecanicoDaConta(lojaId: string, mecanicoId: string, grupoLiberado: string | null, exec: Executor = db) {
  return mecanicoNoEscopo({ contaId: await contaDaLoja(lojaId, exec), grupoLiberado }, mecanicoId, exec)
}
