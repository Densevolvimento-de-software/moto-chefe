// Lista única das Novidades da versão: um arquivo por versão em ./versoes, só para versão com algo
// que a loja percebe. A regra e o teste de formato leem daqui. Passo da release no CONTRIBUTING.md.
import type { NovidadeDaVersao } from './tipos'
import v1_36_0 from './versoes/1.36.0'
import v1_37_0 from './versoes/1.37.0'
import v1_37_1 from './versoes/1.37.1'
import v1_38_0 from './versoes/1.38.0'
import v1_38_1 from './versoes/1.38.1'
import v1_39_0 from './versoes/1.39.0'
import v1_40_0 from './versoes/1.40.0'
import v1_41_0 from './versoes/1.41.0'
import v1_41_1 from './versoes/1.41.1'
import v1_42_0 from './versoes/1.42.0'
import v1_42_1 from './versoes/1.42.1'
import v1_42_2 from './versoes/1.42.2'

export const NOVIDADES_DA_VERSAO: readonly NovidadeDaVersao[] = [v1_36_0, v1_37_0, v1_37_1, v1_38_0, v1_38_1, v1_39_0, v1_40_0, v1_41_0, v1_41_1, v1_42_0, v1_42_1, v1_42_2]
