using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Configuration;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class MonitoredQueryPolicyTests
{
    private static async Task<WebApplication> Start(string environment="Development",bool demo=true)
    {
        var app=AppBootstrap.Build([],builder=>
        {
            builder.Environment.EnvironmentName=environment;
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string,string?>{{"Demo:Enabled",demo.ToString()}});
            builder.WebHost.UseTestServer();
        });
        await app.StartAsync();return app;
    }
    [Fact] public void OnlyReadOnlyStatementsAreAccepted()
    {
        foreach(var statement in new[]
        {
            "select 1",
            "SELECT datname, state FROM pg_stat_activity",
            "select count(*) from pg_stat_replication\n",
            "with active as (select * from pg_stat_activity) select count(*) from active",
            "show status"
        })
        {
            var check=MonitoredQueryPolicy.Check(new(statement));
            Assert.True(check.ConfigurationValid,$"should accept: {statement} -> {string.Join(',',check.Errors.Select(e=>e.Code))}");
            Assert.Empty(check.Errors);
            Assert.False(check.ExecutionAttempted);Assert.False(check.ConnectionAttempted);
        }
        Assert.Equal("select",MonitoredQueryPolicy.Check(new("select 1")).StatementKind);
        Assert.Equal("show",MonitoredQueryPolicy.Check(new("show status")).StatementKind);
        Assert.Equal("with",MonitoredQueryPolicy.Check(new("with a as (select 1) select * from a")).StatementKind);
    }
    [Fact] public void WritesAndAmbiguityAreRejectedWithSpecificCodes()
    {
        (string Statement,string Code)[] cases =
        [
            ("", "required"),
            ("   ", "required"),
            ("select 1; select 2", "multiple_statements"),
            ("update t set a = 1", "not_read_only"),
            ("select 1 -- comment", "comments_not_allowed"),
            ("select /* x */ 1", "comments_not_allowed"),
            ("select * into backup_table from pg_stat_activity", "write_keyword_into"),
            ("with moved as (delete from t returning 1) select * from moved", "write_keyword_delete"),
            ("select pg_terminate_backend(1)", "write_function_pg_terminate_backend"),
            ("select set_config('app.role', 'x', false)", "write_function_set_config"),
            ("select nextval('demo_seq')", "write_function_nextval"),
            ("drop table t", "not_read_only"),
            ("set search_path to public", "not_read_only"),
            ("begin", "not_read_only"),
            ("select * from t for update", "write_keyword_update"),
        ];
        foreach(var (statement,code) in cases)
        {
            var check=MonitoredQueryPolicy.Check(new(statement));
            Assert.False(check.ConfigurationValid,$"should reject: {statement}");
            Assert.Contains(check.Errors,error=>error.Code==code);
        }
        // A word that merely contains a keyword must not be treated as that keyword.
        Assert.True(MonitoredQueryPolicy.Check(new("select selection_note from t")).ConfigurationValid);
        Assert.True(MonitoredQueryPolicy.Check(new("select updated_at from t")).ConfigurationValid);
        Assert.True(MonitoredQueryPolicy.Check(new("select copy_rights from t")).ConfigurationValid);
        Assert.True(MonitoredQueryPolicy.Check(new("select creation_date from t")).ConfigurationValid);
        var longStatement=$"select {new string('a',MonitoredQueryPolicy.MaxStatementLength)}";
        Assert.Contains(MonitoredQueryPolicy.Check(new(longStatement)).Errors,error=>error.Code=="too_long");
        Assert.Contains(MonitoredQueryPolicy.Check(null).Errors,error=>error.Code=="required");
    }
    [Fact] public async Task RouteIsDemoOnlyAndNeverExecutes()
    {
        await using(var app=await Start())
        {
            using var client=app.GetTestClient();
            var ok=await client.PostAsJsonAsync("/api/v1/monitored-query-preflight",new MonitoredQueryDraft("select 1"));
            Assert.Equal(HttpStatusCode.OK,ok.StatusCode);
            var body=await ok.Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(body.GetProperty("data").GetProperty("configurationValid").GetBoolean());
            Assert.False(body.GetProperty("data").GetProperty("executionAttempted").GetBoolean());
            Assert.False(body.GetProperty("data").GetProperty("connectionAttempted").GetBoolean());
            Assert.True(body.GetProperty("data").GetProperty("readOnlyOnly").GetBoolean());
            var rejected=await client.PostAsJsonAsync("/api/v1/monitored-query-preflight",new MonitoredQueryDraft("delete from feedback_records"));
            Assert.Equal(HttpStatusCode.BadRequest,rejected.StatusCode);
            var text=await rejected.Content.ReadAsStringAsync();
            Assert.Contains("not_read_only",text);
            Assert.DoesNotContain("feedback_records",text);
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/monitored-query-preflight",new{statement="select 1",execute=true})).StatusCode);
            using var foreign=new HttpRequestMessage(HttpMethod.Post,"/api/v1/monitored-query-preflight"){Content=JsonContent.Create(new MonitoredQueryDraft("select 1"))};
            foreign.Headers.Add("Origin","https://foreign.example.invalid");
            Assert.Equal(HttpStatusCode.Forbidden,(await client.SendAsync(foreign)).StatusCode);
        }
        await using(var app=await Start("Production",false))
        {
            using var client=app.GetTestClient();
            Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.PostAsJsonAsync("/api/v1/monitored-query-preflight",new MonitoredQueryDraft("select 1"))).StatusCode);
        }
    }
}
