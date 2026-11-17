// Sair por POST numa rota, não Server Action: o login da fábrica não chama action nenhuma
// (@/lib/login-fabrica). Usada pela área /fabrica e por /conta-desativada (#901).
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { saidaDeOutroSite } from '@/lib/login-fabrica'

export async function POST(request: NextRequest) {
  if (saidaDeOutroSite(request.headers.get('origin'), request.nextUrl.origin)) {
    return new NextResponse('Sem permissão', { status: 403 })
  }
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 })
}
