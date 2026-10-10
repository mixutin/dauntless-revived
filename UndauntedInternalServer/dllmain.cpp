#include "CityIdlePolicy.h"
#include <filesystem>
#include <fstream>
#include "HuntIdlePolicy.h"
#include "NativeDiagnostics.h"
#include "ConnectedPlayerSnapshot.h"


#include "ServerFrameLimit.h"
#include <chrono>
#include <thread>


#include <windows.h>
#include <shellapi.h>
#include <string>
#include <vector>
#include <thread>
#include <iostream>
#include <ranges>
#include <cwchar>
#include <map>
#include <array>

#include "framework.h"
#include "SDK.hpp"
#include "MinHook/MinHook.h"
#include "constants.h"
#include "Networking.h"
#include "FallRecovery.h"
#include "TrialsSchedule.h"
#include "AutoPressStart.h"
#include "CellFusionTime.h"
#include "VendorTabs.h"
#include "NoPlatinumPrice.h"
#include "DeveloperStyle.h"

#include "SDK/GameplayAbilities_parameters.hpp"
#include "SDK/Archon_parameters.hpp"
#include "SDK/lantern_equipped_ab_parameters.hpp"

using namespace SDK;

static bool IsRunningUnderWine() {
    HMODULE Ntdll = GetModuleHandleW(L"ntdll.dll");
    return Ntdll != nullptr && GetProcAddress(Ntdll, "wine_get_version") != nullptr;
}

namespace Globals {
    static bool AmServer = false;
    static uintptr_t BaseAddress = 0x0;
    bool Listening = false;
    bool DoListen = false;
    const wchar_t* ServerAPIKey = nullptr;
    const wchar_t* MapPath = nullptr;
    const wchar_t* BehemothPath = nullptr;
    const wchar_t* MatchmakerHuntId = nullptr;
    const wchar_t* ExpectedPlayerString = nullptr;
    int Port = 0;
    const wchar_t* MyIpAndPort = nullptr;
    std::wstring MetagameAddress;

    bool EnableLogging = true;
}

static ConnectedPlayerSnapshot::Cache ConnectedPlayers;

static const std::wstring& WorkerGameSessionId() {
    static const std::wstring Id = [] {
        wchar_t ReadyFile[32768] = {};
        const auto Length = GetEnvironmentVariableW(L"DR_SERVER_READY_FILE", ReadyFile, 32768);
        return Length > 0 && Length < 32768
            ? ConnectedPlayerSnapshot::SessionIdFromReadyFile(std::wstring_view(ReadyFile, Length)) : std::wstring{};
    }();
    return Id;
}

// Called only from GameEngineTickHook. HTTP workers see copied strings under a
// mutex, never engine objects or the connection array. Pointer values in Shape
// are compared only, so a new connection/controller forces an immediate sample.
static void UpdateConnectedPlayerSnapshot() {
    if (WorkerGameSessionId().empty()) return;
    const auto Now = GetTickCount64();
    static ULONGLONG NextCapture = 0;
    static std::vector<std::array<std::uintptr_t, 4>> PreviousShape;
    auto* World = UWorld::GetWorld();
    auto* Driver = Globals::Listening ? Networking::NetDriver : nullptr;
    if (!Driver || !World || Driver->World != World || World->NetDriver != Driver || Driver->ServerConnection) {
        ConnectedPlayers.Publish({}, Now);
        NextCapture = 0;
        return;
    }

    std::vector<std::array<std::uintptr_t, 4>> Shape;
    std::vector<UNetConnection*> Active;
    bool Complete = true;
    int ConnectionCount = 0;
    const auto Inspect = [&](UNetConnection* Connection) {
        if (!Connection || ++ConnectionCount > ConnectedPlayerSnapshot::MaxConnections) {
            Complete = false;
            return;
        }
        const auto State = *reinterpret_cast<const uint32_t*>(reinterpret_cast<uintptr_t>(Connection) + 0x134);
        if (State != 2 && State != 3) {
            Shape.push_back({reinterpret_cast<uintptr_t>(Connection), 0, 0, State});
            if (State != 1) Complete = false; // Only USOCK_Closed is known inactive.
            return; // A closed/unknown connection may retain stale controller fields.
        }
        auto* Controller = Connection->PlayerController;
        auto* PlayerState = Controller ? Controller->PlayerState : nullptr;
        Shape.push_back({reinterpret_cast<uintptr_t>(Connection), reinterpret_cast<uintptr_t>(Controller),
            reinterpret_cast<uintptr_t>(PlayerState), State});
        if (!Controller || !PlayerState
            || !Controller->IsA(AArchonPlayerController::StaticClass())
            || !PlayerState->IsA(AArchonPlayerState::StaticClass())) {
            Complete = false;
            return;
        }
        Active.push_back(Connection);
    };
    const auto ValidCount = [](const auto& Connections) {
        const int Count = Connections.Num();
        return Count >= 0 && Count <= ConnectedPlayerSnapshot::MaxConnections
            && (Count == 0 || Connections.IsValid());
    };
    if (!ValidCount(Driver->ClientConnections)) Complete = false;
    else for (auto* Connection : Driver->ClientConnections) {
        Inspect(Connection);
        if (!Connection) continue;
        if (!ValidCount(Connection->Children)) { Complete = false; continue; }
        for (auto* Child : Connection->Children) {
            Inspect(Child);
            // UE child connections are one level deep. An unexpected structure
            // makes the snapshot incomplete instead of silently losing players.
            if (!Child || Child->Parent != Connection || Child->Children.Num() != 0) Complete = false;
        }
    }
    if (!Complete) {
        ConnectedPlayers.Publish({}, Now);
        NextCapture = 0;
        return;
    }
    if (Now < NextCapture && Shape == PreviousShape) return;

    ConnectedPlayerSnapshot::Builder Snapshot;
    auto* GameplayStatics = Active.empty() ? nullptr : UArchonGameplayStatics::StaticClass();
    if (!Active.empty() && (!GameplayStatics
        || !GameplayStatics->GetFunction("ArchonGameplayStatics", "IsValidNetId")
        || !UArchonGameplayStatics::GetDefaultObj())) {
        ConnectedPlayers.Publish({}, Now);
        PreviousShape = std::move(Shape);
        NextCapture = Now + 1000;
        return;
    }
    for (auto* Connection : Active) {
        auto* PlayerState = static_cast<AArchonPlayerState*>(Connection->PlayerController->PlayerState);
        // The generated wrapper assumes this function exists. Check it first so
        // an incompatible class cannot turn an unknown identity into a crash.
        if (!PlayerState->Class->GetFunction("ArchonPlayerState", "GetUniqueIdAsString")
            || !UArchonGameplayStatics::IsValidNetId(PlayerState->UniqueId)) {
            Snapshot.Invalidate();
            break;
        }
        const auto Id = PlayerState->GetUniqueIdAsString();
        if (!Id.IsValid() || Id.Num() < 2
            || Id.Num() > static_cast<int>(ConnectedPlayerSnapshot::MaxPlayerIdLength + 1)
            || Id.CStr()[Id.Num() - 1] != L'\0') {
            Snapshot.Invalidate();
            break;
        }
        Snapshot.AddConnection(3, std::wstring_view(Id.CStr(), Id.Num() - 1));
    }
    ConnectedPlayers.Publish(Snapshot.Header(), Now);
    PreviousShape = std::move(Shape);
    NextCapture = Now + 1000;
}

std::map<std::wstring, std::wstring> EndpointMap = {};
void EvalEndpointMap() {
    static bool DidEvalEndpointMap = false;

    if (DidEvalEndpointMap || Globals::MetagameAddress.size() == 0)
        return;

    DidEvalEndpointMap = true;

    EndpointMap = {
        {L"AuthEndpoint", L"http://" + Globals::MetagameAddress + L"/game/login"},
        {L"AuthAvailableEndpoint", L"http://" + Globals::MetagameAddress + L"/checkavailable"},
        {L"AuthTagsEndpoint", L"http://" + Globals::MetagameAddress + L"/tags"},
        {L"AccountInfoEndpoint", L"http://" + Globals::MetagameAddress + L"/accountinfo"},
        {L"DauntlessSessionTokenEndpoint", L"http://" + Globals::MetagameAddress + L"/gamesession/{linkedaccountservice}"},
        {L"CreatePhoenixAccountEndpoint", L"http://" + Globals::MetagameAddress + L"/account"},
        {L"LinkAccountEndpoint", L"http://" + Globals::MetagameAddress + L"/account/link"},
        {L"IsAccountLinkedEndpoint", L"http://" + Globals::MetagameAddress + L"/account/link/{service}/{accountid}"},
        {L"LinkPhoenixToServicePinGenerationEndpoint", L"http://" + Globals::MetagameAddress + L"/account/link/pin/{service}/generate"},
        {L"LinkPhoenixToServicePinStatusEndpoint", L"http://" + Globals::MetagameAddress + L"/account/link/pin/{service}/status"},
        {L"QueryLoginQueueEndpoint", L"http://" + Globals::MetagameAddress + L"/login"},
        {L"PublicAccountInfoEndpoint", L"http://" + Globals::MetagameAddress + L"/accountinfo/public"},
        {L"QueryAccountMappingsEndpoint", L"http://" + Globals::MetagameAddress + L"/account/mapping"},
        {L"PlayerDataMigrationEndpoint", L"http://" + Globals::MetagameAddress + L"/account/migrate"},
        {L"PhoenixEventsEndpoint", L"http://" + Globals::MetagameAddress + L"/event?id={environment}"},
        {L"PhoenixEventsMessageEndpoint", L"http://" + Globals::MetagameAddress + L"/services/T02H74TGF/B8GG4RATX/EGSR335K7as3GFBq4dPCm7js"},
        {L"CharacterEndpoint", L"http://" + Globals::MetagameAddress + L"/character"},
        {L"FindCharacterEndpoint", L"http://" + Globals::MetagameAddress + L"/character/{characterid}"},
        {L"CharacterNameEndpoint", L"http://" + Globals::MetagameAddress + L"/character/name"},
        {L"FindCharactersEndpoint", L"http://" + Globals::MetagameAddress + L"/character/batch/account"},
        {L"ResetCharacterEndpoint", L"http://" + Globals::MetagameAddress + L"/character"},
        {L"InventoryEndpoint", L"http://" + Globals::MetagameAddress + L"/inventory"},
        {L"InventoryGetAllEndpoint", L"http://" + Globals::MetagameAddress + L"/inventory/{accountid}/{characterid}"},
        {L"InventoryGetInstanceItemsEndpoint", L"http://" + Globals::MetagameAddress + L"/inventory/instanceditemsbyaccount"},
        {L"InventoryUpdateInstanceEndpoint", L"http://" + Globals::MetagameAddress + L"/inventory/instanceditem"},
        {L"InventoryMigrateEndpoint", L"http://" + Globals::MetagameAddress + L"/inventory/{characterid}/{gameversion}"},
        {L"DeleteProgressionEndpoint", L"http://" + Globals::MetagameAddress + L"/progression/{accountid}/{progressionid}"},
        {L"ProgressionEndpoint", L"http://" + Globals::MetagameAddress + L"/progression"},
        {L"ProgressionConfigEndpoint", L"http://" + Globals::MetagameAddress + L"/progression/config"},
        {L"FindProgressionEndpoint", L"http://" + Globals::MetagameAddress + L"/progression/{accountid}"},
        {L"FindProgressionTrackEndpoint", L"http://" + Globals::MetagameAddress + L"/progression/{accountid}/{progressionid}"},
        {L"FindObjectiveEndpoint", L"http://" + Globals::MetagameAddress + L"/progression/objectives/{accountid}/{objectiveid}"},
        {L"FindObjectivesEndpoint", L"http://" + Globals::MetagameAddress + L"/progression/objectives/{accountid}"},
        {L"GrantProgressionWithObjectives", L"http://" + Globals::MetagameAddress + L"/progression/{accountid}"},
        {L"GrantProgressionEndpoint", L"http://" + Globals::MetagameAddress + L"/progression/{accountid}/{progressionid}/{amount}"},
        {L"ConfirmProgressionEndpoint", L"http://" + Globals::MetagameAddress + L"/progression/{accountid}/{progressionid}/{rank}/confirm/{kind}"},
        {L"GetBountiesConfigEndpoint", L"http://" + Globals::MetagameAddress + L"/bounty/game-data"},
        {L"GetBountiesEndpoint", L"http://" + Globals::MetagameAddress + L"/bounty/{accountid}"},
        {L"SetBountiesEndpoint", L"http://" + Globals::MetagameAddress + L"/bounty/{accountid}"},
        {L"GetPlayerJourneyEndpointServer", L"http://" + Globals::MetagameAddress + L"/pjm/{accountid}"},
        {L"GetPlayerJourneyEndpointClient", L"http://" + Globals::MetagameAddress + L"/pjm"},
        {L"SetPlayerJourneyEndpoint", L"http://" + Globals::MetagameAddress + L"/pjm/{accountid}"},
        {L"DeleteBountiesEndpoint", L"http://" + Globals::MetagameAddress + L"/bounty/delete/{accountid}"},
        {L"GetCooldownEndpoint", L"http://" + Globals::MetagameAddress + L"/cooldown/{accountid}"},
        {L"StartCooldownEndpoint", L"http://" + Globals::MetagameAddress + L"/cooldown/{accountid}/{cooldownid}"},
        {L"SetCooldownEndpoint", L"http://" + Globals::MetagameAddress + L"/cooldown/{accountid}"},
        {L"SetCooldownBatchEndpoint", L"http://" + Globals::MetagameAddress + L"/cooldown/batch/{accountid}"},
        {L"GetSeasonalEscalationEndpoint", L"http://" + Globals::MetagameAddress + L"/escalation/{season_id}/{account_id}"},
        {L"UpdateSeasonalEscalationEndpoint", L"http://" + Globals::MetagameAddress + L"/escalation/{season_id}/{account_id}"},
        {L"GameTuningEndpoint", L"http://" + Globals::MetagameAddress + L"/game_tuning/{blobid}"},
        {L"SelectedHuntPassEndpoint", L"http://" + Globals::MetagameAddress + L"/huntpass/{accountid}"},
        {L"TitleNewsEndpoint", L"http://" + Globals::MetagameAddress + L"/patcher-news/{environment}.json"},
        {L"LoginNewsEndpoint", L"http://" + Globals::MetagameAddress + L"/motd/"},
        {L"AfterHuntNewsEndpoint", L"http://" + Globals::MetagameAddress + L"/motd/trigger?event_name={eventname}"},
        {L"MailboxQueryEndpoint", L"http://" + Globals::MetagameAddress + L"/all/"},
        {L"MailboxQuerySurveyEndpoint", L"http://" + Globals::MetagameAddress + L"/survey/{surveyid}"},
        {L"MessageInboxReadEndpoint", L"http://" + Globals::MetagameAddress + L"/mailbox/markAsRead"},
        {L"MessageInboxDeletedEndpoint", L"http://" + Globals::MetagameAddress + L"/mailbox/markAsDeleted"},
        {L"MessageInboxClaimItemEndpoint", L"http://" + Globals::MetagameAddress + L"/mailbox/redeemParcel"},
        {L"MailboxSubmitSurveyEndpoint", L"http://" + Globals::MetagameAddress + L"/survey/responses"},
        {L"MailboxClaimSurveyRewardEndpoint", L"http://" + Globals::MetagameAddress + L"/survey/redeemReward"},
        {L"MailboxSurveyEndpoint", L"http://" + Globals::MetagameAddress + L"/survey"},
        {L"ExperimentalRealmValidationEndpoint", L"http://" + Globals::MetagameAddress + L"/experiment/validate"},
        {L"SanitizeEndpoint", L"http://" + Globals::MetagameAddress + L"/check"},
        {L"GuildEndpoint", L"http://" + Globals::MetagameAddress + L"/guild"},
        {L"GuildInvitesEndpoint", L"http://" + Globals::MetagameAddress + L"/guild/invites"},
        {L"FindGuildEndpoint", L"http://" + Globals::MetagameAddress + L"/guild/{guildid}"},
        {L"FindCharactersGuildEndpoint", L"http://" + Globals::MetagameAddress + L"/guild/member/{characterid}"},
        {L"GuildMemberEndpoint", L"http://" + Globals::MetagameAddress + L"/guild/member"},
        {L"GuildInviteEndpoint", L"http://" + Globals::MetagameAddress + L"/guild/invite"},
        {L"GuildViewCharacterInviteEndpoint", L"http://" + Globals::MetagameAddress + L"/guild/invite/member/{characterid}"},
        {L"GuildAcceptInviteEndpoint", L"http://" + Globals::MetagameAddress + L"/guild/invite/accept"},
        {L"GuildViewGuildInviteEndpoint", L"http://" + Globals::MetagameAddress + L"/guild/invite/guild"},
        {L"GuildLeaderEndpoint", L"http://" + Globals::MetagameAddress + L"/guild/leader"},
        {L"GuildCreateValidateEndpoint_v2", L"http://" + Globals::MetagameAddress + L"/guild/validate"},
        {L"GuildEndpoint_v2", L"http://" + Globals::MetagameAddress + L"/guild"},
        {L"GuildDisbandEndpoint_v2", L"http://" + Globals::MetagameAddress + L"/guild/{guildId}"},
        {L"GuildViewInvitesEndpoint_v2", L"http://" + Globals::MetagameAddress + L"/guild/invite/player"},
        {L"GuildInviteEndpoint_v2", L"http://" + Globals::MetagameAddress + L"/guild/invite/{accountId}"},
        {L"GuildInviteAcceptEndpoint_v2", L"http://" + Globals::MetagameAddress + L"/guild/invite/accept/{guild_invite_id}"},
        {L"GuildInviteDeclineEndpoint_v2", L"http://" + Globals::MetagameAddress + L"/guild/invite/{guild_invite_id}"},
        {L"GuildLeaveEndpoint_v2", L"http://" + Globals::MetagameAddress + L"/guild/player"},
        {L"GuildKickEndpoint_v2", L"http://" + Globals::MetagameAddress + L"/guild/player/{accountId}"},
        {L"GuildChangeRankEndpoint_v2", L"http://" + Globals::MetagameAddress + L"/guild/rank/{accountId}/{rank}"},
        {L"PartyEndpoint", L"http://" + Globals::MetagameAddress + L"/party"},
        {L"PartyStatusEndpoint", L"http://" + Globals::MetagameAddress + L"/party/status"},
        {L"PartyMemberEndpoint", L"http://" + Globals::MetagameAddress + L"/party/member"},
        {L"PartyKickMemberEndpoint", L"http://" + Globals::MetagameAddress + L"/party/member/{memberid}"},
        {L"PartyRemoveOfflineLeaderEndpoint", L"http://" + Globals::MetagameAddress + L"/party/leader/{leaderid}"},
        {L"PartyPromoteEndpoint", L"http://" + Globals::MetagameAddress + L"/party/member/promote/{memberId}"},
        {L"PartyInvitesEndpoint", L"http://" + Globals::MetagameAddress + L"/party/invites"},
        {L"PartyInviteEndpoint", L"http://" + Globals::MetagameAddress + L"/party/invite"},
        {L"PartyAcceptInviteEndpoint", L"http://" + Globals::MetagameAddress + L"/party/invite/accept/{inviteId}"},
        {L"PartyMemberSetConsoleSessionEndpoint", L"http://" + Globals::MetagameAddress + L"/party/console_session"},
        {L"PartyFinderCreateEndpoint", L"http://" + Globals::MetagameAddress + L"/party/finder/entry/create"},
        {L"PartyFinderEntryEndpoint", L"http://" + Globals::MetagameAddress + L"/party/finder/entry/{partyId}"},
        {L"PartyFinderJoinEndpoint", L"http://" + Globals::MetagameAddress + L"/party/finder/join/{partyId}"},
        {L"PartyFinderListEntriesEndpoint", L"http://" + Globals::MetagameAddress + L"/party/finder/entries"},
        {L"ExpectedPlayerStatusEndpoint", L"http://" + Globals::MetagameAddress + L"/candidate/player/alive"},
        {L"KeepAlivePlayerStatusEndpoint", L"http://" + Globals::MetagameAddress + L"/candidate/player/alive"},
        {L"StoreEndpointDev", L"http://" + Globals::MetagameAddress + L"/{tracking}#{path}"},
        {L"StoreEndpoint", L"http://" + Globals::MetagameAddress + L"/{tracking}#{path}"},
        {L"StoreInternationalEndpointDev", L"http://" + Globals::MetagameAddress + L"/{locale}/{tracking}#{path}"},
        {L"StoreInternationalEndpoint", L"http://" + Globals::MetagameAddress + L"/{locale}/{tracking}#{path}"},
        {L"StoreGetItemByTagEndpoint", L"http://" + Globals::MetagameAddress + L"/product/skus/public?requiredTags={tag}"},
        {L"StoreGetItemByIdEndpoint", L"http://" + Globals::MetagameAddress + L"/product/sku/{sku_id}"},
        {L"StorePurchaseItemEndpoint", L"http://" + Globals::MetagameAddress + L"/token/{currency}/{sku_id}"},
        {L"StorePurchaseItemConfirmEndpoint", L"http://" + Globals::MetagameAddress + L"/notification/{currency}?token={purchase_token}"},
        {L"StoreReconcileUrl", L"http://" + Globals::MetagameAddress + L"/reconcile"},
        {L"StoreBalancesEndpoint", L"http://" + Globals::MetagameAddress + L"/balance"},
        {L"SupportACreatorEndpoint", L"http://" + Globals::MetagameAddress + L"/creator"},
        {L"EntitlementsEndpoint", L"http://" + Globals::MetagameAddress + L"/entitlementsv2"},
        {L"GrantEntitlementEndpoint", L"http://" + Globals::MetagameAddress + L"/entitlementv2/{accountid}"},
        {L"RevokeEntitlementEndpoint", L"http://" + Globals::MetagameAddress + L"/entitlement/{accountid}/{entitlement}"},
        {L"ServiceSessionEndpoint", L"http://" + Globals::MetagameAddress + L"/ws/{accountid}"},
        {L"QueryUserPresenceEndpoint", L"http://" + Globals::MetagameAddress + L"/present/{accountid}"},
        {L"MatchmakingEndpoint", L"http://" + Globals::MetagameAddress},
        {L"TrackingEndpoint", L"http://" + Globals::MetagameAddress},
        {L"VoiceChatLoginEndpoint", L"http://" + Globals::MetagameAddress + L"/vivox/login"},
        {L"VoiceChatJoinPartyEndpoint", L"http://" + Globals::MetagameAddress + L"/vivox/join/party/{channel_type}"},
        {L"VoiceChatJoinGameEndpoint", L"http://" + Globals::MetagameAddress + L"/vivox/join/game/{game_id}/{channel_type}"},
        {L"VoiceChatJoinDebugEndpoint", L"http://" + Globals::MetagameAddress + L"/vivox/join/channel/{channel_id}/{channel_type}"},
        {L"PlatformPoolRegistrationEndpoint", L"http://" + Globals::MetagameAddress + L"/candidate/player/register"},
        {L"CheckCrossPlayProgressionEndpoint", L"http://" + Globals::MetagameAddress + L"/features/platform/{platform}"},
        {L"LeaderboardDisplayNameRefreshEndpoint", L"http://" + Globals::MetagameAddress + L"/profile/update"},
        {L"PhoenixStatusMessageEndpoint", L"http://" + Globals::MetagameAddress + L"/dauntless-status"},
        {L"TrialsLeaderboardsEndpoint", L"http://" + Globals::MetagameAddress + L"/trials/leaderboards"},
        {L"TrialsSoloLeaderboardsEndpoint", L"http://" + Globals::MetagameAddress + L"/trials/leaderboards/solo"},
        {L"TrialsSoloEntryEndpoint", L"http://" + Globals::MetagameAddress + L"/trials/leaderboards/solo/individual"},
        {L"TrialsGroupLeaderboardsEndpoint", L"http://" + Globals::MetagameAddress + L"/trials/leaderboards/group"},
        {L"TrialsGroupEntryEndpoint", L"http://" + Globals::MetagameAddress + L"/trials/leaderboards/group/individual"},
        {L"GetActiveLoadoutEndpoint", L"http://" + Globals::MetagameAddress + L"/loadout/{account_id}/{character_id}"},
        {L"GetAllLoadoutsEndpoint", L"http://" + Globals::MetagameAddress + L"/loadout/{account_id}/{character_id}/all"},
        {L"UpdateLoadoutSlotEndpoint", L"http://" + Globals::MetagameAddress + L"/loadout/{account_id}/{character_id}/{index}"},
        {L"UpdateLoadoutSlotSetActiveEndpoint", L"http://" + Globals::MetagameAddress + L"/loadout/{account_id}/{character_id}/active/{index}"},
        {L"UpdateLoadoutPersistentEndpoint", L"http://" + Globals::MetagameAddress + L"/loadout/{account_id}/{character_id}/persistent"},
        {L"UpdateActiveLoadoutSlotEndpoint", L"http://" + Globals::MetagameAddress + L"/loadout/{account_id}/{character_id}/active/{index}"},
        {L"UnlockAccountSlotEndpoint", L"http://" + Globals::MetagameAddress + L"/loadout/{account_id}/unlock/{num_slots}"},
        {L"UnlockCharacterSlotEndpoint", L"http://" + Globals::MetagameAddress + L"/loadout/{account_id}/{character_id}/unlock/{num_slots}"},
        {L"GetAccountSlotCountEndpoint", L"http://" + Globals::MetagameAddress + L"/loadout/{account_id}/slotcount"},
        {L"GetCharacterSlotCountEndpoint", L"http://" + Globals::MetagameAddress + L"/loadout/{account_id}/{character_id}/slotcount"},
        {L"PlayerInboxMessageEndpoint", L"http://" + Globals::MetagameAddress + L"/subscription"},
        {L"PlayerNewsletterSubscribeEndpoint", L"http://" + Globals::MetagameAddress + L"/subscription"},
        {L"PlayerNewsletterResendEndpoint", L"http://" + Globals::MetagameAddress + L"/subscription/verify/resend"},
        {L"BreadcrumbPlayerEndpoint", L"http://" + Globals::MetagameAddress + L"/breadcrumbs/{character_id}"},
        {L"EncounteredContentGetEndpoint", L"http://" + Globals::MetagameAddress + L"/encountered-content/{character_id}/{content_type}"},
        {L"EncounteredContentQueryEndpoint", L"http://" + Globals::MetagameAddress + L"/encountered-content/query/{character_id}"},
        {L"EncounteredContentUpdateEndpoint", L"http://" + Globals::MetagameAddress + L"/encountered-content/{character_id}"},
        {L"CohortsEndpoint", L"http://" + Globals::MetagameAddress + L"/playertreatments/{account_id}"},
        {L"GetEventStatsEndpoint", L"http://" + Globals::MetagameAddress + L"/eventstats/"},
        {L"IncrementEventStatsEndpoint", L"http://" + Globals::MetagameAddress + L"/eventstats/increment"},
        {L"LinkedSlayersInviteEndpoint", L"http://" + Globals::MetagameAddress + L"/slayerlink/invite"},
        {L"LinkedSlayersAllInvitesEndpoint", L"http://" + Globals::MetagameAddress + L"/slayerlink/invites"},
        {L"LinkedSlayersInviteAcceptDeclineEndpoint", L"http://" + Globals::MetagameAddress + L"/slayerlink/invite"},
        {L"LinkedSlayersInviteCancelEndpoint", L"http://" + Globals::MetagameAddress + L"/slayerlink/invite"},
        {L"LinkedSlayersDeleteAllInvitesEndpoint", L"http://" + Globals::MetagameAddress + L"/slayerlink/invites/{account_id}"},
        {L"LinkedSlayersAllLinksProgressEndpoint", L"http://" + Globals::MetagameAddress + L"/slayerlink/progress"},
        {L"LinkedSlayersAddLinkProgressEndpoint", L"http://" + Globals::MetagameAddress + L"/slayerlink/progress"},
        {L"LinkedSlayersAllLinkSlotsDataEndpoint", L"http://" + Globals::MetagameAddress + L"/slayerlink/links"},
        {L"LinkedSlayersDeleteInviteDataEndpoint", L"http://" + Globals::MetagameAddress + L"/slayerlink/link"},
        {L"LinkedSlayersSendRewardsEndpoint", L"http://" + Globals::MetagameAddress + L"/slayerlink/links/rewards"},
        {L"LinkedSlayersGetFriendsAvailabilityEndpoint", L"http://" + Globals::MetagameAddress + L"/slayerlink/availability"},
        {L"LinkedSlayersGetRewardsGrantEndpoint", L"http://" + Globals::MetagameAddress + L"/slayerlink/links/rewards/{account_id}/{slot}"},
        {L"LinkedSlayersSetEndTimeEndpoint", L"http://" + Globals::MetagameAddress + L"/slayerlink/links/endtime"},
        {L"LinkedSlayersSetRemainingTimeEndpoint", L"http://" + Globals::MetagameAddress + L"/slayerlink/links/timeleft"},
        {L"LinkedSlayersStatusEndpoint", L"http://" + Globals::MetagameAddress + L"/slayerlink/status_good"},
        {L"AccountCheckpointDebugEndpoint", L"http://" + Globals::MetagameAddress + L"/checkpoint/account/save"},
    };
}


__declspec(dllexport) const char* DummyLinkFunc() {
    return "mrow :3";
}

void MainThread() {
    while (!UWorld::GetWorld()) {
        if (Globals::AmServer) {
            Sleep(1000);
        }
        else {
            Sleep(1);
        }
    }

    Sleep(3 * 1000);

    if (!Globals::AmServer) {
        UEngine* Engine = UEngine::GetEngine();

        UInputSettings::GetDefaultObj()->ConsoleKeys[0].KeyName = UKismetStringLibrary::Conv_StringToName(L"F2");

        UObject* NewObject = UGameplayStatics::SpawnObject(Engine->ConsoleClass, Engine->GameViewport);

        Engine->GameViewport->ViewportConsole = static_cast<UConsole*>(NewObject);

        if (Globals::EnableLogging)
        std::cout << "Spawned UConsole!" << std::endl;
    }
    else {
        if (Globals::EnableLogging)
        std::cout << "UWorld is live!" << std::endl;

        Globals::DoListen = true;
    }
}

void* OrigGetDefaultMap = nullptr;

FString* GetGameDefaultMap(FString* a1) {
    FString* Ret = reinterpret_cast<FString*(*)(FString*)>(OrigGetDefaultMap)(a1);

    std::wstring FinalURL(Globals::MapPath);

    std::wstring BehemothPath(Globals::BehemothPath);

    if (!BehemothPath.contains(L"NO_BEHEMOTH")) {
        FinalURL += std::wstring(L"?MonsterClass=");
        FinalURL += std::wstring(BehemothPath);
    }

    std::wstring MatchmakerHuntId(Globals::MatchmakerHuntId);

    if (!MatchmakerHuntId.contains(L"NO_MM_HUNTID")) {
        FinalURL += std::wstring(L"?HuntId=");
        FinalURL += std::wstring(MatchmakerHuntId);
    }

    std::wstring ExpectedPlayers(Globals::ExpectedPlayerString);

    if (!ExpectedPlayers.contains(L"NO_EXPECTED_PLAYERS")) {
        FinalURL += std::wstring(L"?PlayerHuntIds=");
        FinalURL += std::wstring(ExpectedPlayers);
    }

    *Ret = FinalURL.c_str();

    //*Ret = L"ramsgate_01_persistent?game=/Game/Blueprints/BPGM_Archon_Prototype.BPGM_Archon_Prototype_C?MonsterClass=/Game/Monsters/mcrollin/mcbeaver_tutorial_bp.mcbeaver_tutorial_bp_C";

    //*Ret = L"/Game/Maps/islands/1705/dia_moss_triforce?MonsterClass=/Game/Monsters/mcrollin/mcbeaver_tutorial_bp.mcbeaver_tutorial_bp_C";
    //*Ret = L"/Game/Maps/islands/1705/dia_snow_big?MonsterClass=/Game/Monsters/mcrollin/mcbeaver_tutorial_bp.mcbeaver_tutorial_bp_C?HuntId=CR19_MatchmakerHunt_Beaver?PlayerHuntIds=GWOG-UID-1:CR19_PlayerHunt_Expedition_Island04,GWOG-UID-2:CR19_PlayerHunt_Expedition_Island04,GWOG-UID-3:CR19_PlayerHunt_Expedition_Island04?ZonePreset=0";
    //*Ret = L"/Game/Maps/ramsgate/ramsgate_01_persistent";
    //*Ret = L"/Game/Maps/islands/dojo/training_dojo_persistent";
    //*Ret = L"/Game/Maps/islands/1705/dia_moss_triforce?MonsterClass=/Game/Monsters/mcrollin/mcbeaver_tutorial_bp.mcbeaver_tutorial_bp_C";

    return Ret;
}

void* OrigGetCommandLine = nullptr;

const wchar_t* GetCommandLineHook() {
    return L"Dauntless-Win64-Shipping.exe -server -unattended -nullrhi -nosound -EpicPortal -RepDriverDisable";
}

void* OrigServerBootCrash = nullptr;

void ServerBootCrash() {
    return;
}

void* OrigEncounterableSetup = nullptr;

void EncounterableSetupHook() {
    return;
}

HuntIdlePolicy HuntIdle;
CityIdlePolicy CityIdle;
bool IsPooledCity = false;

bool EnableWatchdog = true;

// Read-only counters for diagnostics; the net driver's internal tag is not a frame counter.
extern "C" {
    __declspec(dllexport) volatile unsigned long long DR_ServerTickCount = 0;
    __declspec(dllexport) volatile double DR_ServerSimulatedSeconds = 0;
    __declspec(dllexport) volatile unsigned long long DR_EngineMicros = 0;
    __declspec(dllexport) volatile unsigned long long DR_ReplicationMicros = 0;
}

void* OrigGameEngineTick = nullptr;

void GameEngineTickHook(UGameEngine* GameEngine, float DeltaTime, char CanRender) {
    // Network tick settings do not cap this injected per-frame replication loop.
    // Pace the dedicated game thread using real elapsed time, without a fixed timestep.
    static const int FrameLimit = [] {
        wchar_t Setting[32] = {};
        const auto Length = GetEnvironmentVariableW(L"DR_SERVER_MAX_FPS", Setting, 32);
        return ParseServerFrameLimit(Length < 32 ? Setting : nullptr);
    }();
    static auto PreviousTick = std::chrono::steady_clock::now();
    if (Globals::AmServer && FrameLimit > 0) {
        std::this_thread::sleep_until(PreviousTick + std::chrono::microseconds(1000000 / FrameLimit));
        PreviousTick = std::chrono::steady_clock::now();
    }

    if (IsPooledCity) {
        auto* World = UWorld::GetWorld();
        if (World && World->AuthorityGameMode && World->AuthorityGameMode->GameSession)
            World->AuthorityGameMode->GameSession->MaxPlayers = 20;
    }
    DR_TickStage = 1;
    DR_ServerTickCount = DR_ServerTickCount + 1;
    DR_ServerSimulatedSeconds = DR_ServerSimulatedSeconds + DeltaTime;
    const auto EngineStart = std::chrono::steady_clock::now();
    reinterpret_cast<void(*)(UGameEngine*, float, char)>(OrigGameEngineTick)(GameEngine, DeltaTime, CanRender);
    DR_EngineMicros += std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - EngineStart).count();

    TrialsSchedule::Tick();
    CellFusionTime::Tick();

    // Recover on the authoritative game thread before replicating this frame.
    FallRecovery::Tick(Globals::Listening ? Networking::NetDriver : nullptr, DeltaTime);

    if (Globals::Listening) {
        DR_TickStage = 2;
        const auto ReplicationStart = std::chrono::steady_clock::now();
        Networking::TickNetworking();
        DR_ReplicationMicros += std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - ReplicationStart).count();
        DR_TickStage = 3;
    }

    if (Globals::DoListen) {
        Globals::DoListen = false;
        Globals::Listening = Networking::Listen(UEngine::GetEngine(), Globals::Port);
    }

    UpdateConnectedPlayerSnapshot();

    if (Globals::Listening && Networking::NetDriver) {
        bool HasConnection = false;
        int ActiveConnections = 0;

        for (UNetConnection* Connection : Networking::NetDriver->ClientConnections) {
            // Pending (2) and open (3) connections protect clients still loading.
            if (Connection && (*(uint32_t*)((uintptr_t)Connection + 0x134) == 2
                || *(uint32_t*)((uintptr_t)Connection + 0x134) == 3)) {
                HasConnection = true;
                ++ActiveConnections;
            }
        }

        static auto PreviousIdleCheck = std::chrono::steady_clock::now();
        const auto IdleNow = std::chrono::steady_clock::now();
        const double Elapsed = std::chrono::duration<double>(IdleNow - PreviousIdleCheck).count();
        PreviousIdleCheck = IdleNow;
        if (IsPooledCity) {
            static auto NextOccupancyWrite = IdleNow;
            if (IdleNow >= NextOccupancyWrite) {
                NextOccupancyWrite = IdleNow + std::chrono::seconds(1);
                wchar_t Directory[32768] = {};
                const auto Length = GetEnvironmentVariableW(L"GAMESERVER_READY_DIR", Directory, 32768);
                if (Length > 0 && Length < 32768) {
                    const auto File = std::filesystem::path(Directory) / (L"city-occupancy-" + std::to_wstring(GetCurrentProcessId()) + L".txt");
                    const auto Temporary = std::filesystem::path(File.wstring() + L".tmp");
                    { std::ofstream Output(Temporary); Output << GetCurrentProcessId() << " " << ActiveConnections << "\n"; }
                    MoveFileExW(Temporary.c_str(), File.c_str(), MOVEFILE_REPLACE_EXISTING);
                }
            }
        }
        const bool IdleExpired = IsPooledCity ? CityIdle.Advance(Elapsed, HasConnection)
            : EnableWatchdog && HuntIdle.Advance(Elapsed, HasConnection);
        if (IdleExpired) {
            std::cout << "Hunt idle timeout on port " << Globals::Port << std::endl;
            DR_WriteDiagnostic("idle_timeout\n", 13);
            // This is an injected DLL in a multithreaded UE process. CRT exit runs
            // teardown while engine threads still use its state, hanging/crashing.
            // Only empty temporary worlds reach here; end the whole process without DLL teardown.
            TerminateProcess(GetCurrentProcess(), 0);
            return;
        }

        for (UNetConnection* Conn : Networking::NetDriver->ClientConnections) {
            if (!Conn || !Conn->PlayerController || !Conn->PlayerController->Pawn)
                continue;
            auto* Pawn = Conn->PlayerController->Pawn;
            if (!Pawn->IsA(ABP_PlayerCharacter_C::StaticClass()) || Pawn->IsActorBeingDestroyed())
                continue;
            static_cast<ABP_PlayerCharacter_C*>(Pawn)->TickStamina(ECityExecFilter::Both, ERemoteExecFilter::All);
        }
    }
}

void* OrigFixupNetworkNotify = nullptr;

void* FixupNetworkNotifyHook(void* a1) {
    if(UWorld::GetWorld())
        *(void**)((uintptr_t)a1 + 0x208) = &UWorld::GetWorld()->NetworkNotify;

    return reinterpret_cast<void* (*)(void*)>(OrigFixupNetworkNotify)(a1);
}

void* OrigProcessRequest = nullptr;

char ProcessRequest(void* Request) {
    FString APIHeader(L"x-undaunted-gameserver-apikey");
    FString APIKey(Globals::ServerAPIKey);

    const auto SetHeader = reinterpret_cast<void(*)(void*, FString*, FString*)>(Globals::BaseAddress + 0x28AAAA0);
    SetHeader(Request, &APIHeader, &APIKey);

    const auto& SessionId = WorkerGameSessionId();
    if (!SessionId.empty()) {
        const auto Snapshot = ConnectedPlayers.Read(GetTickCount64());
        FString SessionHeader(L"x-dauntless-game-session-id");
        FString SessionValue(SessionId.c_str());
        FString ConnectedHeader(L"x-dauntless-connected-player-ids");
        FString ConnectedValue(Snapshot.c_str());
        SetHeader(Request, &SessionHeader, &SessionValue);
        // Clear a previous value on a reused/retried HTTP request too. Empty is
        // deliberately invalid JSON and means unknown, while [] means empty.
        SetHeader(Request, &ConnectedHeader, &ConnectedValue);
    }

    return reinterpret_cast<char(*)(void*)>(OrigProcessRequest)(Request);
}

enum EFunctionCallspace : uint32_t
{
    /** This function call should be absorbed (ie client side with no authority) */
    Absorbed = 0x0,
    /** This function call should be called remotely via its net driver */
    Remote = 0x1,
    /** This function call should be called locally */
    Local = 0x2
};

void* OrigGetActorCallspace = nullptr;

EFunctionCallspace GetActorCallspace(AActor* Actor, UFunction* Function, void* Stack) {
    if (Function->GetFullName().contains("Ammo")) {
        std::cout << Actor->GetFullName() << " - " << Function->GetFullName() << std::endl;
    }

    return reinterpret_cast<EFunctionCallspace(*)(AActor*, UFunction*, void*)>(OrigGetActorCallspace)(Actor, Function, Stack);
}

void* OrigPostLogin = nullptr;

void PostLoginHook(void* a1, AArchonPlayerController* a2) {
    reinterpret_cast<void(*)(void*, void*)>(OrigPostLogin)(a1, a2);
}

void* OrigHasFinishedLoading = nullptr;

bool HasFinishedLoadingHook(UObject* a1) {
    bool Ret = reinterpret_cast<bool(*)(UObject*)>(OrigHasFinishedLoading)(a1);

    if (!Ret) {
        if (Globals::EnableLogging)
        std::cout << "[FORCEREADY] " << a1->GetFullName() << std::endl;
        return true;
    }

    return Ret;
}

void* OrigIsNetReady = nullptr;

bool IsNetReadyHook() {
    return true;
}

void* OrigSetReplicationDriver = nullptr;

void SetReplicationDriverHook(UNetDriver* NetDriver, UReplicationDriver* RepDriver) {
    return reinterpret_cast<void(*)(UNetDriver*, UReplicationDriver*)>(OrigSetReplicationDriver)(NetDriver, nullptr);
}

void* OrigGetNetDriverInternal = nullptr;

UNetDriver* GetNetDriverInternalHook(void* a1, void* a2) {
    UNetDriver* NetDriver = reinterpret_cast<UNetDriver* (*)(void*, void*)>(OrigGetNetDriverInternal)(a1, a2);

    if (!NetDriver) {
        NetDriver = Networking::NetDriver;
    }

    return NetDriver;
}

void* OrigIsLevelInitForActor = nullptr;

bool IsLevelInitForActorHook(void* a1, char a2) {
    bool NetDriver = reinterpret_cast<bool (*)(void*, char)>(OrigIsLevelInitForActor)(a1, a2);

    if (!NetDriver) {
        return true;
    }

    return NetDriver;
}

void* OrigGetStartSpot = nullptr;

// 0x1368660 is Phoenix's GetPlayerStartForPlayer: it filters AArchonPlayerStart::GroupName and
// selects with AArchonPlayerState::PlayerStartSlot. Do not replace it with the first global
// APlayerStart: that can select a start from the wrong group/world and breaks fall/respawn recovery.
static UWorld* GetObjectWorld(UObject* Object) {
    for (UObject* Current = Object; Current; Current = Current->Outer) {
        if (Current->IsA(SDK::UWorld::StaticClass()))
            return static_cast<UWorld*>(Current);
    }

    return nullptr;
}

static AArchonPlayerStart* PickPlayerStartFallback(AArchonPlayerState* PlayerState, const FName& StartGroup, bool MatchGroup) {
    UWorld* PlayerWorld = GetObjectWorld(PlayerState);
    std::vector<AArchonPlayerStart*> Candidates;

    for (int i = 0; i < SDK::UObject::GObjects->Num(); i++) {
        SDK::UObject* Obj = SDK::UObject::GObjects->GetByIndex(i);
        if (!Obj || Obj->IsDefaultObject() || !Obj->IsA(SDK::AArchonPlayerStart::StaticClass()))
            continue;

        auto* Start = static_cast<AArchonPlayerStart*>(Obj);
        if (PlayerWorld && GetObjectWorld(Start) != PlayerWorld)
            continue;
        if (MatchGroup && Start->GroupName != StartGroup)
            continue;

        Candidates.push_back(Start);
    }

    if (Candidates.empty())
        return nullptr;

    const int32 Slot = PlayerState ? PlayerState->PlayerStartSlot : -1;
    const size_t Index = Slot >= 0 ? static_cast<size_t>(Slot) % Candidates.size() : 0;
    return Candidates[Index];
}

AArchonPlayerStart* GetStartSpotHook(AArchonPlayerState* PlayerState, FName StartGroup) {
    using GetPlayerStartForPlayerFn = AArchonPlayerStart* (*)(AArchonPlayerState*, FName);
    auto* Start = reinterpret_cast<GetPlayerStartForPlayerFn>(OrigGetStartSpot)(PlayerState, StartGroup);
    if (Start) {
        FallRecovery::RememberStart(PlayerState, Start);
        return Start;
    }

    Start = PickPlayerStartFallback(PlayerState, StartGroup, true);
    if (!Start)
        Start = PickPlayerStartFallback(PlayerState, StartGroup, false);

    if (Globals::EnableLogging) {
        if (Start) {
            std::cout << "Native player-start selection returned null; fallback group="
                      << StartGroup.ToString() << " slot="
                      << (PlayerState ? PlayerState->PlayerStartSlot : -1) << " -> "
                      << Start->GetFullName() << std::endl;
        } else {
            std::cout << "No player start found for group=" << StartGroup.ToString()
                      << " slot=" << (PlayerState ? PlayerState->PlayerStartSlot : -1) << std::endl;
        }
    }

    FallRecovery::RememberStart(PlayerState, Start);
    return Start;
}

bool ServerTryActivateAbilityInternal(UAbilitySystemComponent* Component, FGameplayAbilitySpecHandle& AbilityHandle, bool InputPressed, FPredictionKey& PredictionKey, FGameplayEventData* TriggerEventData) {
    if(InputPressed)
        Component->ServerSetInputPressed(AbilityHandle);

    void* InstancedAbility = nullptr;

    bool Activated = reinterpret_cast<bool(*)(UAbilitySystemComponent*, uint32_t, FPredictionKey*, void**, void*, FGameplayEventData*)>(Globals::BaseAddress + 0x10C8C80)(Component, AbilityHandle.Handle, &PredictionKey, &InstancedAbility, nullptr, TriggerEventData);

    if (!Activated && InputPressed)
        Component->ServerSetInputReleased(AbilityHandle);

    return Activated;
}

void* OrigMakeDoDamage = nullptr;

bool MakeDoDamageHook(void* a1, void* a2, void* a3) {
    *(uint8_t*)((uintptr_t)a1 + 0x57C) = 1;

    return true;
}

#include <fstream>

void* OrigProcessEventClient = nullptr;

static bool IsPurchasableTonic(const UEquipmentItemViewModel* Item) {
    if (!Item || Item->PurchaseItemId.ToString() != "CURRENCY_NOTES" || Item->PurchaseCost <= 0 || Item->MaxCanPurchase <= 0)
        return false;

    const std::string Id = Item->ItemId.ToString();
    return Id == "QI_ATTACK_SPEED_POTION"
        || Id == "QI_DAMAGE_BLOCK_POTION"
        || Id == "QI_DAMAGE_ENRAGEBONUS_POTION"
        || Id == "QI_EXPOSE_POTION"
        || Id == "QI_LANTERN_POTION"
        || Id == "QI_LIFESTEAL_AOE_POTION"
        || Id == "QI_STAGGER_POTION"
        || Id == "QI_STAMINA_POTION_00";
}

static bool IsPotionPurchaseQuestOpen() {
    for (int i = 0; i < SDK::UObject::GObjects->Num(); i++) {
        SDK::UObject* Obj = SDK::UObject::GObjects->GetByIndex(i);
        if (!Obj || Obj->IsDefaultObject() || !Obj->IsA(SDK::UQuestSystemComponent::StaticClass()))
            continue;

        auto* QuestSystem = static_cast<UQuestSystemComponent*>(Obj);
        for (UQuest* Quest : QuestSystem->GetAllQuests()) {
            if (!Quest || Quest->GetId().ToString() != "CR19_S5_Q2C2_Bosun_PotionPurchase")
                continue;

            const EQuestStatus Status = Quest->GetStatus();
            return Status == EQuestStatus::Accepted
                || Status == EQuestStatus::Redeemable
                || Status == EQuestStatus::Redeemed
                || Status == EQuestStatus::Available;
        }
    }

    return false;
}

void ProcessEventClientHook(UObject* Object, UFunction* Function, void* Parms) {
    reinterpret_cast<void(*)(UObject*, UFunction*, void*)>(OrigProcessEventClient)(Object, Function, Parms);

    TrialsSchedule::Tick();
    CellFusionTime::Tick();
    AutoPressStart::OnProcessEvent(Object, Function);
    VendorTabs::OnProcessEvent(Object);
    NoPlatinumPrice::OnProcessEvent(Object);
    DeveloperStyle::OnProcessEvent(Object, Function);

    static UFunction* CanPurchase = nullptr;
    if (Function == CanPurchase || (!CanPurchase && Function && Function->GetFullName().contains("EquipmentItemViewModel.CanPurchase"))) {
        CanPurchase = Function;

        auto* Item = Object && Object->IsA(UEquipmentItemViewModel::StaticClass())
            ? static_cast<UEquipmentItemViewModel*>(Object)
            : nullptr;
        auto* Purchase = static_cast<Params::EquipmentItemViewModel_CanPurchase*>(Parms);

        // 1.4.4 gates every normal tonic purchase on CR19_S5_Q2C2_Bosun_PotionPurchase.
        // Revived can leave that child quest Available while the vendor screen is already open.
        // Preserve the retail price/affordability gate and only relax this one quest-state mismatch.
        if (Purchase && !Purchase->ReturnValue && IsPurchasableTonic(Item) && IsPotionPurchaseQuestOpen())
            Purchase->ReturnValue = true;
    }
}

static int NumTimesOnAirshipUpdated = 0;
bool DidDoTravelReset = false;

void* OrigProcessEvent = nullptr;

void ProcessEventHook(UObject* Object, UFunction* Function, void* Parms) {
    static UFunction* ServerTryActivateAbilityWithEventData = nullptr;
    static UFunction* ServerTryActivateAbility = nullptr;

    if (Function == ServerTryActivateAbilityWithEventData || (!ServerTryActivateAbilityWithEventData && Function->GetFullName().contains("ServerTryActivateAbilityWithEventData"))) {
        ServerTryActivateAbilityWithEventData = Function;

        Params::AbilitySystemComponent_ServerTryActivateAbilityWithEventData* ActivateAbilityParams = (Params::AbilitySystemComponent_ServerTryActivateAbilityWithEventData*)Parms;

        ServerTryActivateAbilityInternal((UAbilitySystemComponent*)Object, ActivateAbilityParams->AbilityToActivate, ActivateAbilityParams->InputPressed, ActivateAbilityParams->PredictionKey, &ActivateAbilityParams->TriggerEventData);
        // Replaces the native RPC handler; forwarding would activate it twice.
        return;
    }
    else if (Function == ServerTryActivateAbility || (!ServerTryActivateAbility && Function->GetFullName().contains("ServerTryActivateAbility"))) {
        ServerTryActivateAbility = Function;

        Params::AbilitySystemComponent_ServerTryActivateAbility* ActivateAbilityParams = (Params::AbilitySystemComponent_ServerTryActivateAbility*)Parms;

        ServerTryActivateAbilityInternal((UAbilitySystemComponent*)Object, ActivateAbilityParams->AbilityToActivate, ActivateAbilityParams->InputPressed, ActivateAbilityParams->PredictionKey, nullptr);
        // Replaces the native RPC handler; forwarding would activate it twice.
        return;
    }

    reinterpret_cast<void(*)(UObject*, UFunction*, void*)>(OrigProcessEvent)(Object, Function, Parms);
}

void* OrigConfigCacheIniGetString = nullptr;

bool ConfigCacheInitGetStringHook(void* a1, const wchar_t* Section, const wchar_t* Key, FString* Value, FString* Filename) {
    EvalEndpointMap();

    if (EndpointMap.contains(Key)) {
        *Value = FString(EndpointMap.at(Key).c_str());

        return true;
    }

    // Dedicated servers only override Phoenix endpoints; leave other subsystem settings intact.
    if (Globals::AmServer)
        return reinterpret_cast<bool(*)(void*, const wchar_t*, const wchar_t*, FString*, FString*)>(OrigConfigCacheIniGetString)(a1, Section, Key, Value, Filename);

    if (std::wstring(Section).contains(L"Mcp")) {
        if (std::wstring(Key).contains(L"protocol") || std::wstring(Key).contains(L"Protocol")) {
            *Value = FString(L"http");

            return true;
        }
        
        if (std::wstring(Key).contains(L"Domain") || std::wstring(Key).contains(L"RedirectUrl")) {
            *Value = FString(Globals::MetagameAddress.c_str());

            return true;
        }
    }
    
    return reinterpret_cast<bool(*)(void* a1, const wchar_t* Section, const wchar_t* Key, FString * Value, FString * Filename)>(OrigConfigCacheIniGetString)(a1, Section, Key, Value, Filename);
}

void* OrigGetEscalationSeason = nullptr;

bool GetEscalationSeason(UHuntCatalog* a1, FString* HuntID, FHunt_UnlockInfo* UnlockInfo, FHunt_UnlockInfo* AltUnlockInfo, AArchonPlayerController* PC) { // TODO: Fixup scheduling & Player leveling so this hack isn't necessary
    // The Trials screen shows the first unlocked weekly row, so only this week's row may pass.
    bool IsTrialRow = false;
    const bool TrialRowUnlocked = TrialsSchedule::IsTrialRowUnlocked(HuntID->ToString(), PC, IsTrialRow);
    if (IsTrialRow)
        return TrialRowUnlocked;

    if (HuntID->ToString().contains("Arena") || (HuntID->ToString().contains("Esca") && !HuntID->ToString().contains("Mint"))) {
        return true;
    }

    return reinterpret_cast<bool(*)(UHuntCatalog * a1, FString * HuntID, FHunt_UnlockInfo * UnlockInfo, FHunt_UnlockInfo * AltUnlockInfo, AArchonPlayerController * PC)>(OrigGetEscalationSeason)(a1, HuntID, UnlockInfo, AltUnlockInfo, PC);
}

void* OrigGetTrackProgress = nullptr;

__int64 GetTrackProgress(void* a1, FName* a2, void* a3) {
    if (a2) {
        std::cout << a2->ToString() << std::endl;
    }

    return 9999999;
}

// Set to 0 to drop the EAC client init hook below (and its two lines in InitClientHooks).
#define DR_SKIP_EAC_CLIENT_INIT 1

#if DR_SKIP_EAC_CLIENT_INIT
void* OrigEACClientInit = nullptr;

// The EAC client plugin's init (the function that checks -NoEAC). It still ends up in
// CreateGameClient, which fails and leaves the "Failed to create IGameClient instance!" popup.
// Doing nothing here is the same as its own -NoEAC exit.
void EACClientInitHook(void* a1) {
}
#endif

//__int64 *__fastcall sub_141428060(__int64 a1, __int64 *a2, unsigned __int8 a3, char a4)

void InitClientHooks() {
    MH_Initialize();

#if DR_SKIP_EAC_CLIENT_INIT
    MH_CreateHook((void*)(Globals::BaseAddress + 0xEF2440), EACClientInitHook, &OrigEACClientInit);

    MH_EnableHook((void*)(Globals::BaseAddress + 0xEF2440));
#endif

    MH_CreateHook((void*)(Globals::BaseAddress + 0x1528000), HasFinishedLoadingHook, &OrigHasFinishedLoading);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x1528000));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x1D09D50), ConfigCacheInitGetStringHook, &OrigConfigCacheIniGetString);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x1D09D50));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x14F2A30), GetEscalationSeason, &OrigGetEscalationSeason);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x14F2A30));

    //

    //1469E00

    //MH_CreateHook((void*)(Globals::BaseAddress + 0x1469E00), GetTrackProgress, &OrigGetTrackProgress);

    //MH_EnableHook((void*)(Globals::BaseAddress + 0x1469E00));


    //MH_CreateHook((void*)(Globals::BaseAddress + 0x347E110), IsNetReadyHook, &OrigIsNetReady);

    //MH_EnableHook((void*)(Globals::BaseAddress + 0x347E110));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x1F61820), ProcessEventClientHook, &OrigProcessEventClient);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x1F61820));

   // MH_CreateHook((void*)(Globals::BaseAddress + 0x3077710), GetActorCallspace, &OrigGetActorCallspace);

   // MH_EnableHook((void*)(Globals::BaseAddress + 0x3077710));
}

void* OrigSprint = nullptr;

bool SprintHook(uintptr_t a1, uintptr_t a2) { //char __fastcall UArchonStaminaComponent_TryConsumeStamina_Native(__int64 a1, __int64 a2, char a3, char a4)    
    return true;
}

void* OrigNetModeHook = nullptr;

int NetModeHook(void* a1) { //char __fastcall UArchonStaminaComponent_TryConsumeStamina_Native(__int64 a1, __int64 a2, char a3, char a4)   
    return 1;
}

void InitServerHooks() {
    MH_Initialize();
    Networking::InitChannelTracking(Globals::BaseAddress);

    // SYSTEM and service accounts do not inherit a launcher-generated Game.ini.
    // The worker reaches the same backend through its loopback SSH tunnel.
    Globals::MetagameAddress = L"127.0.0.1:61000";
    MH_CreateHook((void*)(Globals::BaseAddress + 0x1D09D50), ConfigCacheInitGetStringHook, &OrigConfigCacheIniGetString);
    MH_EnableHook((void*)(Globals::BaseAddress + 0x1D09D50));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x25A37C0), GetGameDefaultMap, &OrigGetDefaultMap);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x25A37C0));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x1D06D40), GetCommandLineHook, &OrigGetCommandLine);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x1D06D40));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x2E4D7F0), ServerBootCrash, &OrigServerBootCrash);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x2E4D7F0));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x1658f90), EncounterableSetupHook, &OrigEncounterableSetup);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x1658f90));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x3307100), GameEngineTickHook, &OrigGameEngineTick);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x3307100));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x820120), FixupNetworkNotifyHook, &OrigFixupNetworkNotify);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x820120));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x28A76C0), ProcessRequest, &OrigProcessRequest);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x28A76C0));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x1390300), EncounterableSetupHook, &OrigEncounterableSetup); // TODO: Rename to combat text

    MH_EnableHook((void*)(Globals::BaseAddress + 0x1390300));

    //MH_CreateHook((void*)(Globals::BaseAddress + 0x3077710), GetActorCallspace, &OrigGetActorCallspace);

    //MH_EnableHook((void*)(Globals::BaseAddress + 0x3077710));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x14B7460), PostLoginHook, &OrigPostLogin);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x14B7460));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x1528000), HasFinishedLoadingHook, &OrigHasFinishedLoading);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x1528000));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x347E110), IsNetReadyHook, &OrigIsNetReady);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x347E110));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x3491720), SetReplicationDriverHook, &OrigSetReplicationDriver);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x3491720));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x3078AF0), GetNetDriverInternalHook, &OrigGetNetDriverInternal);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x3078AF0));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x3458780), IsLevelInitForActorHook, &OrigIsLevelInitForActor);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x3458780));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x1368660), GetStartSpotHook, &OrigGetStartSpot);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x1368660));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x1F61820), ProcessEventHook, &OrigProcessEvent);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x1F61820));

    //MH_CreateHook((void*)(Globals::BaseAddress + 0x35996D0), MakeDoDamageHook, &OrigMakeDoDamage);

    //MH_EnableHook((void*)(Globals::BaseAddress + 0x35996D0));

    //MH_CreateHook((void*)(Globals::BaseAddress + 0x137A800), SprintHook, &OrigSprint);

    //MH_EnableHook((void*)(Globals::BaseAddress + 0x137A800));

    MH_CreateHook((void*)(Globals::BaseAddress + 0x378BDA0), NetModeHook, &OrigNetModeHook);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x378BDA0));

    //MH_CreateHook((void*)(Globals::BaseAddress + 0x1469E00), GetTrackProgress, &OrigGetTrackProgress);

   // MH_EnableHook((void*)(Globals::BaseAddress + 0x1469E00));

    
    MH_CreateHook((void*)(Globals::BaseAddress + 0x14F2A30), GetEscalationSeason, &OrigGetEscalationSeason);

    MH_EnableHook((void*)(Globals::BaseAddress + 0x14F2A30));

    //

    //13CA280

    //GetStartSpotHook

    // Fixup Listen failure
    DWORD oldProtect;
    VirtualProtect((void*)(Globals::BaseAddress + 0x372E746), 0x5, PAGE_READWRITE, &oldProtect);

    *(uint8_t*)(Globals::BaseAddress + 0x372E746 + 0x0) = 0xB0;
    *(uint8_t*)(Globals::BaseAddress + 0x372E746 + 0x1) = 0x01;
    *(uint8_t*)(Globals::BaseAddress + 0x372E746 + 0x2) = 0x90;
    *(uint8_t*)(Globals::BaseAddress + 0x372E746 + 0x3) = 0x90;
    *(uint8_t*)(Globals::BaseAddress + 0x372E746 + 0x4) = 0x90;

    VirtualProtect((void*)(Globals::BaseAddress + 0x372E746), 0x5, oldProtect, &oldProtect);

    // Fixup Ramsgate Crash
    VirtualProtect((void*)(Globals::BaseAddress + 0x1346A98), 0x7, PAGE_READWRITE, &oldProtect);

    *(uint8_t*)(Globals::BaseAddress + 0x1346A98 + 0x0) = 0x33;
    *(uint8_t*)(Globals::BaseAddress + 0x1346A98 + 0x1) = 0xF6;
    *(uint8_t*)(Globals::BaseAddress + 0x1346A98 + 0x2) = 0x33;
    *(uint8_t*)(Globals::BaseAddress + 0x1346A98 + 0x3) = 0xC0;
    *(uint8_t*)(Globals::BaseAddress + 0x1346A98 + 0x4) = 0x90;
    *(uint8_t*)(Globals::BaseAddress + 0x1346A98 + 0x5) = 0x90;
    *(uint8_t*)(Globals::BaseAddress + 0x1346A98 + 0x6) = 0x90;

    VirtualProtect((void*)(Globals::BaseAddress + 0x1346A98), 0x7, oldProtect, &oldProtect);

    //GIsServer and GIsClient
    VirtualProtect((void*)(Globals::BaseAddress + 0x7961AE), 0x9, PAGE_READWRITE, &oldProtect);

    *(uint8_t*)(Globals::BaseAddress + 0x7961AE + 0x0) = 0xC6;
    *(uint8_t*)(Globals::BaseAddress + 0x7961AE + 0x1) = 0x05;
    *(uint8_t*)(Globals::BaseAddress + 0x7961AE + 0x2) = 0x84;
    *(uint8_t*)(Globals::BaseAddress + 0x7961AE + 0x3) = 0x5A;
    *(uint8_t*)(Globals::BaseAddress + 0x7961AE + 0x4) = 0x6B;
    *(uint8_t*)(Globals::BaseAddress + 0x7961AE + 0x5) = 0x05;
    *(uint8_t*)(Globals::BaseAddress + 0x7961AE + 0x6) = 0x00;
    *(uint8_t*)(Globals::BaseAddress + 0x7961AE + 0x7) = 0x90;
    *(uint8_t*)(Globals::BaseAddress + 0x7961AE + 0x8) = 0x90;

    VirtualProtect((void*)(Globals::BaseAddress + 0x7961AE), 0x9, oldProtect, &oldProtect);

    VirtualProtect((void*)(Globals::BaseAddress + 0x7961BB), 0x9, PAGE_READWRITE, &oldProtect);

    *(uint8_t*)(Globals::BaseAddress + 0x7961BB + 0x0) = 0xC6;
    *(uint8_t*)(Globals::BaseAddress + 0x7961BB + 0x1) = 0x05;
    *(uint8_t*)(Globals::BaseAddress + 0x7961BB + 0x2) = 0x78;
    *(uint8_t*)(Globals::BaseAddress + 0x7961BB + 0x3) = 0x5A;
    *(uint8_t*)(Globals::BaseAddress + 0x7961BB + 0x4) = 0x6B;
    *(uint8_t*)(Globals::BaseAddress + 0x7961BB + 0x5) = 0x05;
    *(uint8_t*)(Globals::BaseAddress + 0x7961BB + 0x6) = 0x01;
    *(uint8_t*)(Globals::BaseAddress + 0x7961BB + 0x7) = 0x90;
    *(uint8_t*)(Globals::BaseAddress + 0x7961BB + 0x8) = 0x90;

    VirtualProtect((void*)(Globals::BaseAddress + 0x7961BB), 0x9, oldProtect, &oldProtect);

    VirtualProtect((void*)(Globals::BaseAddress + 0x79A81B), 0x7, PAGE_READWRITE, &oldProtect);

    *(uint8_t*)(Globals::BaseAddress + 0x79A81B + 0x0) = 0xC6;
    *(uint8_t*)(Globals::BaseAddress + 0x79A81B + 0x1) = 0x05;
    *(uint8_t*)(Globals::BaseAddress + 0x79A81B + 0x2) = 0x17;
    *(uint8_t*)(Globals::BaseAddress + 0x79A81B + 0x3) = 0x14;
    *(uint8_t*)(Globals::BaseAddress + 0x79A81B + 0x4) = 0x6B;
    *(uint8_t*)(Globals::BaseAddress + 0x79A81B + 0x5) = 0x05;
    *(uint8_t*)(Globals::BaseAddress + 0x79A81B + 0x6) = 0x00;

    VirtualProtect((void*)(Globals::BaseAddress + 0x79A81B), 0x7, oldProtect, &oldProtect);

    VirtualProtect((void*)(Globals::BaseAddress + 0x79A680), 0x1, PAGE_READWRITE, &oldProtect);

    *(uint8_t*)(Globals::BaseAddress + 0x79A680 + 0x0) = 0x00;

    VirtualProtect((void*)(Globals::BaseAddress + 0x79A680), 0x1, oldProtect, &oldProtect);

    VirtualProtect((void*)(Globals::BaseAddress + 0x79A815), 0x1, PAGE_READWRITE, &oldProtect);

    *(uint8_t*)(Globals::BaseAddress + 0x79A815 + 0x0) = 0x01;

    VirtualProtect((void*)(Globals::BaseAddress + 0x79A815), 0x1, oldProtect, &oldProtect);
}

void Init() {

    Globals::AmServer = std::string(GetCommandLineA()).contains("-server");
    Globals::BaseAddress = (uintptr_t)GetModuleHandleA(nullptr);

    if (Globals::AmServer) {
        *(uint8_t*)(Globals::BaseAddress + 0x5E4BC3A) = 0x1; // GIsServer
        *(uint8_t*)(Globals::BaseAddress + 0x5E4BC39) = 0x0; // GIsClient
    }

    UC::FMemory::Init((void*)(Globals::BaseAddress + 0x1C8EE00));

    if (Globals::AmServer) {
        int NumArgs = 0;

        wchar_t** Args = CommandLineToArgvW(GetCommandLineW(), &NumArgs);

        if (NumArgs > 8) {
            Globals::ServerAPIKey = Args[1];
            Globals::Port = std::stoi(std::wstring(Args[2]));
            Globals::MapPath = Args[3];
            Globals::BehemothPath = Args[4];
            Globals::MatchmakerHuntId = Args[5];
            Globals::ExpectedPlayerString = Args[6];
            Globals::MyIpAndPort = Args[7];

            if (std::wstring(Globals::MapPath).contains(L"/ramsgate/ramsgate_01_persistent")) {
                wchar_t Pool[2] = {};
                IsPooledCity = GetEnvironmentVariableW(L"DR_RAMSGATE_POOL", Pool, 2) == 1 && Pool[0] == L'1';
                EnableWatchdog = false;
                Globals::EnableLogging = true;
            }
        }
        else {
            MessageBoxA(nullptr, "INVALID GAMESERVER ARGS", "INVALID GAMESERVER ARGS", 0);
            exit(0);
            return;
        }

        if (Globals::EnableLogging) {
            AllocConsole();
            FILE* Dummy;
            freopen_s(&Dummy, "CONOUT$", "w", stdout);
            freopen_s(&Dummy, "CONIN$", "r", stdin);

            std::cout << "Welcome to Undaunted v" << UNDAUNTED_INTERNAL_VERSION << "!" << std::endl;
            std::cout << "prod. gwog :3" << std::endl;
            std::cout << "thanks to all who contributed in any way, you know who you are, dm me on discord if you want a named shoutout here :3" << std::endl;

            std::cout << "Running as a server!" << std::endl;
        }

        DR_InitDiagnostics();
        InitServerHooks();
    }
    else {
        Globals::EnableLogging = true;

        if (Globals::EnableLogging) {
            if (!IsRunningUnderWine()) {
                AllocConsole();
                // Players don't need the log window: keep it hidden, off the screen and the taskbar, so
                // it never covers the game and can't be closed by mistake (closing it ends the game).
                // DR_SHOW_CONSOLE=1 in the environment keeps it visible for troubleshooting.
                // The console host shows the window a moment after AllocConsole returns, and the game
                // shows it again whenever it changes screens (loading into the world, display mode
                // changes), so a small thread keeps it hidden for the whole session.
                char ShowConsole[2] = {};
                if (GetEnvironmentVariableA("DR_SHOW_CONSOLE", ShowConsole, sizeof(ShowConsole)) != 1 || ShowConsole[0] != '1') {
                    CreateThread(nullptr, 0, [](LPVOID) -> DWORD {
                        for (;;) {
                            HWND Console = GetConsoleWindow();
                            if (Console && IsWindowVisible(Console)) ShowWindow(Console, SW_HIDE);
                            Sleep(50);
                        }
                    }, nullptr, 0, nullptr);
                }
                FILE* Dummy;
                freopen_s(&Dummy, "CONOUT$", "w", stdout);
                freopen_s(&Dummy, "CONIN$", "r", stdin);
            }

            std::cout << "Welcome to Undaunted v" << UNDAUNTED_INTERNAL_VERSION << "!" << std::endl;
            std::cout << "prod. gwog :3" << std::endl;
            std::cout << "thanks to all who contributed in any way, you know who you are, dm me on discord if you want a named shoutout here :3" << std::endl;

            std::cout << "Running as a debug-enabled client!" << std::endl;
        }

        int NumArgs = 0;

        wchar_t** Args = CommandLineToArgvW(GetCommandLineW(), &NumArgs);

        if (NumArgs > 2) {
            Globals::MetagameAddress = Args[1];
        }

        DR_InitDiagnostics(); // only when GAMESERVER_READY_DIR is set, e.g. a manual debug launch
        InitClientHooks();
    }

    DWORD threadId;
    CreateThread(nullptr, 0x1000, (LPTHREAD_START_ROUTINE)MainThread, nullptr, 0, &threadId);
}

BOOL APIENTRY DllMain( HMODULE hModule,
                       DWORD  ul_reason_for_call,
                       LPVOID lpReserved
                     )
{
    switch (ul_reason_for_call)
    {
    case DLL_PROCESS_ATTACH:
        DisableThreadLibraryCalls(hModule);
        Init();
    case DLL_THREAD_ATTACH:
    case DLL_THREAD_DETACH:
    case DLL_PROCESS_DETACH:
        break;
    }
    return TRUE;
}

