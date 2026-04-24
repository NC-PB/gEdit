import fanucGcode from './fanuc-gcode.json';
import heidenhainKlartext from './heidenhain-klartext.json';

export interface BlockConfig {
  Description: string;
  Text: string;
  Button: boolean;
  TextBlock: string;
}

export const activeBlocksLib: Record<string, Record<string, BlockConfig>> = {
  'fanuc-gcode': fanucGcode as Record<string, BlockConfig>,
  'heidenhain-klartext': heidenhainKlartext as Record<string, BlockConfig>
};
