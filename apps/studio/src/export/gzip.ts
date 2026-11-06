/**
 * Gzipped size of a string, measured with the platform's CompressionStream
 * (browsers and Node 18+). Null where it isn't available.
 */
export async function gzipSize(text: string): Promise<number | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return (await new Response(stream).arrayBuffer()).byteLength;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 2 : 1)} KB`;
}
