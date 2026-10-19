import "./setup";
import "./deployenv";
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, it } from 'node:test';
import {
    DescribeGameservers, Gameserver, Gameservers, GameserverStateForTests, ResetGameserversForTests,
    Startup, StartupGameserverWithArgs, TrackGameserverForTests, UseProcessFunctionsForTests,
} from '../src/controllers/gameservers';

// A UDP port hosts one server. A record that outlives its process keeps claiming its port, and
// because pids are reused the liveness check can keep calling it alive. A live host listed four
// ports twice over, each pair sharing one real process; the stale half of each pair is what the
// launcher shows as a world with nobody in it.

const TUTORIAL = "/Game/Maps/islands/1705/dia_moss_triforce?MaxPlayers=1?MonsterClass=/Game/Monsters/mcrollin/mcbeaver_tutorial_bp.mcbeaver_tutorial_bp_C";

let NextPid = 52000;

function FakeSpawn(): ChildProcess {
    const Child = new EventEmitter() as any;
    Child.pid = NextPid++;
    Child.exitCode = null;
    Child.signalCode = null;
    Child.unref = () => {};
    Child.kill = () => true;
    Child.killed = false;
    return Child as ChildProcess;
}

function StaleRecord(Port: number): Gameserver {
    return {
        id: `stale-${Port}`, port: Port, map: '/Game/Maps/islands/1705/dia_moss_triforce_2',
        behemoth: undefined, matchmakerHuntId: undefined, expectedPlayers: undefined,
        isRamsgate: false, isTrainingDojo: false,
        // A pid that still answers: the recycled-pid case the liveness check cannot see through.
        processId: process.pid, startTime: new Date(Date.now() - 45 * 60 * 1000),
    };
}

afterEach(() => { ResetGameserversForTests(); UseProcessFunctionsForTests({}); });

describe('port uniqueness', () => {
    it('drops a record still claiming the port a new server is given', async () => {
        UseProcessFunctionsForTests({ Spawn: FakeSpawn, IsAlive: () => true, IsPortBound: async () => false });
        await Startup();

        // Whichever port the pool will hand out next, left claimed by a record whose process is
        // gone and whose exit was never delivered.
        const Pool = GameserverStateForTests().FreePorts;
        const Next = Pool[Pool.length - 1];
        TrackGameserverForTests(StaleRecord(Next));
        assert.equal(Gameservers.filter(s => s.port === Next).length, 1, 'the stale record should be in place');

        await StartupGameserverWithArgs(TUTORIAL);

        const OnPort = Gameservers.filter(s => s.port === Next);
        assert.equal(OnPort.length, 1, `port ${Next} should hold one record, found ${OnPort.length}`);
        assert.notEqual(OnPort[0].id, `stale-${Next}`, 'the stale record should have been dropped, not the new one');
        assert.equal(DescribeGameservers().filter(s => s.port === Next).length, 1,
            'the launcher must never be shown two worlds on one port');
    });

    it('leaves records on other ports alone', async () => {
        UseProcessFunctionsForTests({ Spawn: FakeSpawn, IsAlive: () => true, IsPortBound: async () => false });
        await Startup();

        const Pool = GameserverStateForTests().FreePorts;
        const Next = Pool[Pool.length - 1];
        const Other = Pool[0];
        TrackGameserverForTests(StaleRecord(Next));
        TrackGameserverForTests(StaleRecord(Other));

        await StartupGameserverWithArgs(TUTORIAL);

        assert.equal(Gameservers.filter(s => s.id === `stale-${Other}`).length, 1,
            'a record on an unrelated port must not be touched');
    });
});
