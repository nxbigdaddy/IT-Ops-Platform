using OpsPlatform.Api.Contracts;

namespace OpsPlatform.Api.Services;

// Read-only port for the prompt catalog. A durable implementation may replace it without touching the
// mutation rules, which stay with the service that owns validation and version semantics.
public interface IPromptCatalog
{
    IReadOnlyList<PromptDto> List();
    PromptDto? Get(string id);
    IReadOnlyList<PromptBindingDto> Bindings();
    // Feature coverage: which registered features own a prompt, which do not, and which prompts are unregistered.
    PromptFeatureCoverage FeatureCoverage();
}
