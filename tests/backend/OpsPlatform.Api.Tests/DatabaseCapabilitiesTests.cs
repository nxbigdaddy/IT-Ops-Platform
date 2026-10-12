using OpsPlatform.Api.Configuration;
using OpsPlatform.Api.Services;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class DatabaseCapabilitiesTests
{
    private static DatabaseDeploymentDraft Draft(DatabaseProvider provider) => new(provider,"db-01.invalid","secret://database/demo",1,1,false);
    [Fact] public void CatalogCoversEveryEnumWithoutClaimingAdapters()
    {
        Assert.Equal(Enum.GetValues<DatabaseProvider>().Length, DatabaseCapabilities.List().Count);
        foreach(var item in DatabaseCapabilities.List()) { Assert.False(item.AdapterImplemented); Assert.False(item.LiveVerified); Assert.False(item.ProductionEnabled); Assert.NotEmpty(item.RequiredVerification); }
        Assert.Single(DatabaseCapabilities.List(), x=>x.PackageAvailable);
        Assert.Equal(DatabaseProvider.PostgreSQL,DatabaseCapabilities.List().Single(x=>x.PackageAvailable).Provider);
    }
    [Theory]
    [InlineData(DatabaseProvider.PostgreSQL)] [InlineData(DatabaseProvider.SqlServer)] [InlineData(DatabaseProvider.Sqlite)] [InlineData(DatabaseProvider.MySql)]
    public void DraftValidationDoesNotMeanConnectionOrProduction(DatabaseProvider provider)
    {var result=DatabaseCapabilities.ValidateDraft(Draft(provider));Assert.True(result.ConfigurationValid);Assert.False(result.ConnectionAttempted);Assert.False(result.ProductionReady);}
    [Fact] public void RejectsFallbackAndInvalidReferences()
    {
        Assert.False(DatabaseCapabilities.ValidateDraft(Draft(DatabaseProvider.PostgreSQL) with{AutomaticFallback=true}).ConfigurationValid);
        Assert.False(DatabaseCapabilities.ValidateDraft(Draft(DatabaseProvider.PostgreSQL) with{SecretReference="Password=mock-only"}).ConfigurationValid);
        Assert.False(DatabaseCapabilities.ValidateDraft(null).ConfigurationValid);
        Assert.False(DatabaseCapabilities.ValidateDraft(Draft((DatabaseProvider)999)).ConfigurationValid);
    }
    [Theory] [InlineData(0,0)] [InlineData(33,0)] [InlineData(1,-1)] [InlineData(1,129)]
    public void RejectsInvalidCounts(int api,int workers)=>Assert.False(DatabaseCapabilities.ValidateDraft(Draft(DatabaseProvider.PostgreSQL) with{ApiInstances=api,WorkerInstances=workers}).ConfigurationValid);
    [Fact] public void SqliteCannotBecomeDistributedByConfiguration()
    {
        Assert.False(DatabaseCapabilities.ValidateDraft(Draft(DatabaseProvider.Sqlite) with{ApiInstances=2}).ConfigurationValid);
        Assert.False(DatabaseCapabilities.ValidateDraft(Draft(DatabaseProvider.Sqlite) with{WorkerInstances=2}).ConfigurationValid);
        Assert.True(DatabaseCapabilities.ValidateDraft(Draft(DatabaseProvider.PostgreSQL) with{ApiInstances=2,WorkerInstances=2}).ConfigurationValid);
    }
    [Fact] public void RealDatabaseHostsAreRejectedLikeAnyOtherTarget()
    {
        foreach(var host in new[]{"db-01.invalid","198.51.100.7","2001:db8::9","db-02.example"})
            Assert.True(DatabaseCapabilities.ValidateDraft(Draft(DatabaseProvider.PostgreSQL) with{Host=host}).ConfigurationValid,host);
        foreach(var host in new[]{"db-01.internal","10.0.0.5","db-01.example.com","DB-01.invalid"," db-01.invalid","",new string('x',254)+".invalid"})
        {
            var check=DatabaseCapabilities.ValidateDraft(Draft(DatabaseProvider.PostgreSQL) with{Host=host});
            Assert.False(check.ConfigurationValid,host);
            Assert.Contains(check.Errors,error=>error.Field=="host"&&error.Code=="not_documentation_target");
        }
    }
    [Fact] public void ReturnedSnapshotsCannotMutateFutureCatalog()
    {
        var first=DatabaseCapabilities.List();first[0].RequiredVerification[0]="tampered";
        Assert.DoesNotContain("tampered",DatabaseCapabilities.List()[0].RequiredVerification);
        var providers=new DemoCatalogService().DatabaseProviders;
        Assert.All(providers,p=>{Assert.Equal("planned",p.Status);Assert.False(p.Implemented);Assert.False(p.Verified);Assert.False(p.OutboundEnabled);});
    }
}
