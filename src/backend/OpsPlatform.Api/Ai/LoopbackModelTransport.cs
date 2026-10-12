using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;

namespace OpsPlatform.Api.Ai;

public sealed record LoopbackTransportOutcome(
    string Status,
    AiDraftResult? Result,
    string? Code,
    int HttpStatus,
    int ResponseBytes,
    long ElapsedMilliseconds,
    // The synthetic payload this adapter actually sent, so a reviewer can confirm no credential is included.
    string SentRequestJson)
{
    // Loopback only: this adapter never reaches a real provider and never carries a credential.
    public bool LoopbackOnly => true;
    public bool CredentialRead => false;
    public bool ProductionTransportImplemented => false;
    public string Notes => "仅允许 http://127.0.0.1 或 http://localhost 的合成桩；不读取凭据、不发送请求到任何真实提供方。";
}

// Development-only transport used to exercise the real request builder and response parser against a local
// stub over a real socket. It refuses every non-loopback endpoint before attempting a connection, sends no
// authorization header, bounds the response size and never echoes the response body in its outcome.
public sealed class LoopbackModelTransport
{
    public const int MaxResponseBytes = 262144;
    public const int MaxRequestBytes = 262144;
    public static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(5);
    private readonly HttpClient client;
    public LoopbackModelTransport(HttpClient? client = null)
    {
        this.client = client ?? new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, UseProxy = false, ConnectTimeout = TimeSpan.FromSeconds(2) })
        {
            Timeout = Timeout.InfiniteTimeSpan,
        };
    }
    public static bool IsLoopbackEndpoint(string? endpoint)
    {
        if (string.IsNullOrWhiteSpace(endpoint)) return false;
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri)) return false;
        // Plain http only, no credentials in the URL, no query or fragment.
        if (uri.Scheme != Uri.UriSchemeHttp) return false;
        if (!string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)) return false;
        var host = uri.Host.Trim('[', ']');
        if (host is "localhost") return true;
        return IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address);
    }
    public async Task<LoopbackTransportOutcome> SendAsync(string protocol, string endpoint, AiDraftRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!IsLoopbackEndpoint(endpoint))
            return new("refused", null, "endpoint_not_loopback", 0, 0, 0, string.Empty);
        if (!AiProtocols.IsAccepted(protocol))
            return new("refused", null, "unsupported_protocol", 0, 0, 0, string.Empty);
        JsonDocument payload;
        try
        {
            payload = protocol == AiProtocols.OpenAiCompatible
                ? OpenAiChatCompletionsAdapter.BuildRequest(request)
                : AnthropicMessagesAdapter.BuildRequest(request);
        }
        catch (AiProtocolException error)
        {
            return new("refused", null, error.Code, 0, 0, 0, string.Empty);
        }
        using (payload)
        {
            // Bounded copy of exactly what is transmitted; it contains only the synthetic prompt content.
            var sent = payload.RootElement.GetRawText();
            if (sent.Length > MaxRequestBytes) return new("refused", null, "request_too_large", 0, 0, 0, string.Empty);
            using var content = new StringContent(sent, Encoding.UTF8, "application/json");
            // No Authorization header by design: the loopback stub needs no credential and none is read.
            using var message = new HttpRequestMessage(HttpMethod.Post, new Uri(endpoint)) { Content = content };
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(DefaultTimeout);
            var stopwatch = Stopwatch.StartNew();
            HttpResponseMessage response;
            try
            {
                response = await client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                return new("timeout", null, "loopback_timeout", 0, 0, stopwatch.ElapsedMilliseconds, sent);
            }
            catch (HttpRequestException)
            {
                return new("unreachable", null, "loopback_unreachable", 0, 0, stopwatch.ElapsedMilliseconds, sent);
            }
            using (response)
            {
                var status = (int)response.StatusCode;
                var bytes = await ReadBounded(response, timeout.Token).ConfigureAwait(false);
                if (bytes.TooLarge) return new("rejected", null, "response_too_large", status, bytes.Count, stopwatch.ElapsedMilliseconds, sent);
                if (status != 200) return new("rejected", null, "http_status_not_ok", status, bytes.Count, stopwatch.ElapsedMilliseconds, sent);
                try
                {
                    var parsed = protocol == AiProtocols.OpenAiCompatible
                        ? OpenAiChatCompletionsAdapter.ParseSyntheticResponse(bytes.Text)
                        : AnthropicMessagesAdapter.ParseSyntheticResponse(bytes.Text);
                    return new("parsed", parsed, null, status, bytes.Count, stopwatch.ElapsedMilliseconds, sent);
                }
                catch (AiProtocolException error)
                {
                    return new("rejected", null, error.Code, status, bytes.Count, stopwatch.ElapsedMilliseconds, sent);
                }
            }
        }
    }
    private static async Task<(string Text, int Count, bool TooLarge)> ReadBounded(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        var buffer = new byte[8192];
        using var accumulated = new MemoryStream();
        while (true)
        {
            var read = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (read == 0) break;
            accumulated.Write(buffer, 0, read);
            if (accumulated.Length > MaxResponseBytes) return (string.Empty, (int)accumulated.Length, true);
        }
        return (Encoding.UTF8.GetString(accumulated.ToArray()), (int)accumulated.Length, false);
    }
}
