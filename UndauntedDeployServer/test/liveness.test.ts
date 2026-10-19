import "./setup";
import "./deployenv";
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, it } from 'node:test';
import {
    DescribeGameservers, Gameserver, Gameservers, IsGameserverAlive, ResetGameserversForTests,
    Startup, StartupGameserverWithArgs, UseProcessFunctionsForTests,
} from '../src/controllers/gameservers';

// A pid does not identify a process. Windows hands the number back out once ours has exited, and
// kill(pid, 0) then keeps succeeding for whatever received it. A live host listed 23 instances
// against 8 real game processes: the extras showed 0 players and ages of many hours, because
// nothing could tell they were gone. Liveness has to come from the child handle we own.

const TUTORIAL = "/Game/Maps/islands/1705/dia_moss_triforce?MaxPlayers=1?MonsterClass=/Game/Monsters/mcrollin/mcbeaver_tutorial_bp.mcbeaver_tutorial_bp_C";

let Child: any;

function FakeSpawn(): ChildProcess {
    Child = new EventEmitter() as any;
    Child.pid = 41999;
    Child.exitCode = null;
    Child.signalCode = null;
    Child.unref = () => {};
    Child.kill = () => true;
    Child.killed = false;
    return Child as ChildProcess;
}

afterEach(() => { ResetGameserversForTests(); UseProcessFunctionsForTests({}); });

describe('game server liveness', () => {
    it('reports a server dead once its child has exited, even while the pid still answers', async () => {
        UseProcessFunctionsForTests({
            Spawn: FakeSpawn,
            // "Alive" throughout: this is exactly what a recycled pid looks like.
            IsAlive: () => true,
            IsPortBound: async () => false,
        });

        await Startup();
        await StartupGameserverWithArgs(TUTORIAL);
        const Server = Gameservers.find(s => !s.isRamsgate && !s.isTrainingDojo)!;
        assert.ok(Server, 'the server should be registered');
        assert.equal(IsGameserverAlive(Server), true, 'a running child is alive');
        assert.ok(DescribeGameservers().some(s => s.port === Server.port), 'a running child is listed');

        // The process goes away without its exit event being observed.
        Child.exitCode = 0;

        assert.equal(IsGameserverAlive(Server), false,
            'a pid that still answers must not keep a dead instance alive');
        assert.ok(!DescribeGameservers().some(s => s.port === Server.port),
            'a dead instance must not be listed to the launcher or dashboard');
    });

    it('still honours an explicit liveness check, so existing callers are unchanged', () => {
        const Fake: Gameserver = {
            id: 'x', port: 8770, map: '/Game/Maps/islands/1705/dia_moss_triforce_2', behemoth: undefined,
            matchmakerHuntId: undefined, expectedPlayers: undefined, isRamsgate: false,
            isTrainingDojo: false, processId: 999999, startTime: new Date(),
        };

        assert.equal(DescribeGameservers([Fake], () => true).length, 1);
        assert.equal(DescribeGameservers([Fake], () => false).length, 0);
    });
});
