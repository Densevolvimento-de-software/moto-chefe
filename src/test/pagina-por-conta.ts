import { after, before, mock } from 'node:test'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { apagarContasSemeadas, semearContaBase, semearUsuario, type Base } from '@/test/semear-conta'

/**
 * Teste de banco de uma página (Server Component) renderizada na sessão de quem é de cada Conta.
 * Só a fronteira de fora é simulada (sessão, cookies, redirect, notFound); grupo ativo e consultas rodam
 * de verdade no Postgres descartável. Chame no topo do arquivo, antes de importar a página. Ao fim apaga as
 * Contas semeadas e o que pende delas (`apagarContasSemeadas`).
 * `entrar(sessao, grupoNoCookie)` põe uma sessão pronta (persona, papel específico) e o cookie `grupoAtivo`.
 */
export class NaoEncontrada extends Error {}

export function paginaPorConta(prefixo: string) {
  const url = process.env.TEST_DATABASE_URL
  if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Use somente Postgres descartável local')
  process.env.DATABASE_URL = url

  let sessao: Record<string, unknown> = {}
  let grupoNoCookie: string | undefined
  const mocks = [
    mock.module('@/lib/auth', { namedExports: { getUsuarioLogado: async () => sessao } }),
    mock.module('next/headers', { namedExports: { cookies: async () => ({ get: (nome: string) => (nome === 'grupoAtivo' && grupoNoCookie ? { value: grupoNoCookie } : undefined) }) } }),
    mock.module('next/navigation', { namedExports: {
      redirect: (destino: string) => { throw new Error(`redirect ${destino}`) },
      notFound: () => { throw new NaoEncontrada() },
    } }),
  ]
  let db: typeof import('@/lib/db')['db']
  const contas: Base[] = []

  before(async () => { ({ db } = await import('@/lib/db')) })
  after(async () => {
    try {
      await apagarContasSemeadas(db, { contaIds: contas.map(c => c.contaId), prefixo })
    } finally {
      for (const m of mocks) m.restore()
      await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end()
    }
  })

  return {
    db: () => db,
    entrar(usuario: Record<string, unknown>, grupoAtivo?: string) { sessao = usuario; grupoNoCookie = grupoAtivo },
    async conta(nome: string, cnpj: string) {
      const base = await semearContaBase(db, { prefixo, nome, cnpj })
      contas.push(base)
      return base
    },
    /** HTML da página na sessão de um sócio (todo o grupo) ou de um vendedor (a loja da Conta). */
    async renderizarComo(pagina: () => Promise<ReactNode>, base: Base, papel: 'admin_socio' | 'vendedor', rotulo: string) {
      const socio = papel === 'admin_socio'
      const id = await semearUsuario(db, base, { papel, rotulo, semLoja: socio, comGrupo: socio })
      sessao = { id, papel, lojaId: socio ? null : base.lojaId, gruposAcesso: socio ? [base.grupoId] : [], contaId: base.contaId, grupoLiberado: null }
      grupoNoCookie = undefined
      return renderToStaticMarkup(createElement('div', null, await pagina()))
    },
  }
}
