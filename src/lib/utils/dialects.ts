/** Monaco language ids of the NC dialects gEdit supports. */
export type Dialect = 'fanuc-gcode' | 'heidenhain-klartext';

export interface DialectInfo {
  /** Short name for the status bar. */
  label: string;
  /** Name of the save-dialog file filter. */
  filterName: string;
  /** File extensions (without dot), preferred one first. */
  extensions: string[];
  /** File name suggested when saving an untitled buffer. */
  defaultFileName: string;
}

export const DIALECTS: Record<Dialect, DialectInfo> = {
  'fanuc-gcode': {
    label: 'Fanuc',
    filterName: 'Fanuc G-Code',
    extensions: ['nc', 'txt', 'min'],
    defaultFileName: 'program.nc',
  },
  'heidenhain-klartext': {
    label: 'Heidenhain',
    filterName: 'Heidenhain Klartext',
    extensions: ['h', 'txt'],
    defaultFileName: 'program.h',
  },
};

export function isDialect(value: string): value is Dialect {
  return Object.prototype.hasOwnProperty.call(DIALECTS, value);
}
