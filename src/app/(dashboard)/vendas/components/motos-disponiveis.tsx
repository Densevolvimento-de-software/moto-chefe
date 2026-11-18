'use client'
import { createContext, useContext, type ReactNode } from 'react'
import type { MotoDisponivel } from '@/lib/novo-pedido'

const MotosDisponiveis = createContext<MotoDisponivel[]>([])

/** As motos disponíveis da página, uma vez só para todos os cards: o "Editar pedido" de cada um lê daqui (#25, 25c). */
export function MotosDisponiveisProvider({ motos, children }: { motos: MotoDisponivel[]; children: ReactNode }) {
  return <MotosDisponiveis.Provider value={motos}>{children}</MotosDisponiveis.Provider>
}

export const useMotosDisponiveis = () => useContext(MotosDisponiveis)
