import { notFound } from 'next/navigation'
import { Hanken_Grotesk, Montserrat, Open_Sans } from 'next/font/google'
import { buscarVendaDoCertificado } from '@/lib/queries/vendas'
import { getUsuarioLogado } from '@/lib/auth'
import { PrintTrigger } from '@/components/print-trigger'
import { FolhaCertificadoBateria } from '@/components/folha-certificado-bateria'

// As três fontes do protótipo aprovado (#235). O título usa a Montserrat no lugar da fonte paga do PDF.
const montserrat = Montserrat({ subsets: ['latin'], weight: '800', variable: '--font-montserrat' })
const hanken = Hanken_Grotesk({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-hanken' })
const openSans = Open_Sans({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-open-sans' })

export default async function CertificadoBateriaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const usuario = await getUsuarioLogado()
  // Venda de outra Conta ou loja, fora da regra "loja MotoChefe" e id inexistente: o mesmo notFound.
  const venda = await buscarVendaDoCertificado(id, usuario)
  if (!venda) notFound()

  return (
    <div className={`${montserrat.variable} ${hanken.variable} ${openSans.variable}`}>
      <PrintTrigger />
      <FolhaCertificadoBateria venda={venda} />
    </div>
  )
}
