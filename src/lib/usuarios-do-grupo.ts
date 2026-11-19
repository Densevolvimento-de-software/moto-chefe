import { and, inArray, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { usuarios } from '@/lib/db/schema'
import { lojasDoGrupo, usuarioOuLojaDaConta } from '@/lib/conta'

type Executor = Pick<typeof db, 'select'>
type Papel = (typeof usuarios.papel.enumValues)[number]

// "Do grupo" = loja do usuário no grupo ou grupo no grupos_acesso, dentro da Conta do
// grupo: a mesma posse do seletor (podeVerGrupo). admin_geral sem loja fica de fora de propósito: lista global
// mostrava usuários de outros clientes do MOVA. Lojas do grupo em subconsulta: quem usa não precisa de join.
export const usuarioDoGrupo = (grupoId: string) => and(
  or(
    inArray(usuarios.lojaId, lojasDoGrupo(grupoId)),
    sql`${grupoId}::uuid = any(${usuarios.gruposAcesso})`,
  ),
  // Marcação de grupo de outra Conta não vale (ADR-0018, adendo de 21/10).
  sql`${usuarios.contaId} = (select conta_id from grupos where id = ${grupoId}::uuid)`,
)

// Usuário que um registro da Conta pode ligar (vendedor, mecânico): o da Conta, ou só o do grupo
// liberado na persona do admin_rede (#517), a mesma função da lista da tela.
export const usuarioDoEscopo = ({ contaId, grupoLiberado }: { contaId: string; grupoLiberado: string | null }) =>
  grupoLiberado ? usuarioDoGrupo(grupoLiberado) : usuarioOuLojaDaConta(contaId)

export async function listarUsuariosDoGrupo(
  grupoId: string,
  filtro: { papeis?: readonly Papel[] } = {},
  exec: Executor = db,
): Promise<{ id: string; nome: string }[]> {
  // Papel extra conta como o principal; senão o filtro do dashboard esconde as vendas
  // de quem vende sem ter 'vendedor' como papel principal.
  const doPapel = filtro.papeis
    ? or(inArray(usuarios.papel, [...filtro.papeis]), sql`${usuarios.papeisExtras} && ${sql.param([...filtro.papeis])}::text[]`)
    : undefined
  return exec
    .select({ id: usuarios.id, nome: usuarios.nome })
    .from(usuarios)
    .where(and(usuarioDoGrupo(grupoId), doPapel))
    .orderBy(usuarios.nome)
}
