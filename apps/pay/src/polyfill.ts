// Must be the first import: @ton/core reads Buffer at module load.
import { Buffer } from 'buffer';
(globalThis as any).Buffer = Buffer;
