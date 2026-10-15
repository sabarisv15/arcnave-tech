/** heic-decode ships no types. Its default export decodes a HEIC/HEIF still to RGBA pixels. */
declare module 'heic-decode' {
  export default function decode(input: { buffer: Buffer | ArrayBuffer | Uint8Array }): Promise<{
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }>;
}
