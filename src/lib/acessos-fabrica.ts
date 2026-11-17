// Formulário de /admin/acessos-fabrica (login da fábrica, papel `fabrica`): regra pura. A tela e a
// action validam pela mesma função, e só nome, e-mail e senha saem do que veio do navegador.
import { emailValido } from '@/lib/email-valido'
import { FRASE_SENHA_CURTA, senhaCurta } from '@/lib/senha'

export type DadosAcessoFabrica = { nome: string; email: string; senha: string }

const texto = (v: unknown) => (typeof v === 'string' ? v : null)

export function validarAcessoFabrica(entrada: unknown): { ok: true; dados: DadosAcessoFabrica } | { ok: false; erro: string } {
  const e = (entrada ?? {}) as Record<string, unknown>
  const nome = texto(e.nome)?.trim() ?? ''
  const email = texto(e.email)?.trim().toLowerCase() ?? ''
  const senha = texto(e.senha) ?? ''
  if (!nome) return { ok: false, erro: 'Informe o nome do acesso.' }
  if (!emailValido(email)) return { ok: false, erro: 'Informe um e-mail válido para o login.' }
  if (senhaCurta(senha)) return { ok: false, erro: FRASE_SENHA_CURTA }
  return { ok: true, dados: { nome, email, senha } }
}
