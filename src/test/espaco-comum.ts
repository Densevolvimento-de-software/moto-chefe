/** O Intl separa "R$" do valor com espaço sem quebra; o texto esperado nos testes usa o espaço comum. */
export const espacoComum = (texto: string) => texto.replace(/ /g, ' ')
