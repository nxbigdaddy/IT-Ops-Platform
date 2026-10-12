export class ResponseSizeError extends Error {}
/** Bounds decoded network bytes before JSON parsing; does not validate application schema. */
export async function readBoundedJson(response: Response, maximumBytes = 1_048_576): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error('invalid_response_limit')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('missing_response_body')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0, text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maximumBytes) throw new ResponseSizeError('response_too_large')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text) as unknown
  } catch (error) {
    try { await reader.cancel() } catch { /* Preserve original failure after transport abort. */ }
    throw error
  } finally { reader.releaseLock() }
}
