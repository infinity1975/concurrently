const readline = require('readline');
const Rx = require('rxjs');
const { buffer, filter, map, takeUntil, tap } = require('rxjs/operators');
const spawn = require('spawn-command');

const isWindows = process.platform === 'win32';
const killExitCode = isWindows ? 1 : 'SIGTERM';

const run = args => {
    const child = spawn('node ./concurrently.js ' + args, {
        cwd: __dirname
    });

    const stdout = readline.createInterface({
        input: child.stdout,
        output: null
    });

    const stderr = readline.createInterface({
        input: child.stderr,
        output: null
    });

    const close = Rx.fromEvent(child, 'close');
    const log = Rx.merge(
        Rx.fromEvent(stdout, 'line'),
        Rx.fromEvent(stderr, 'line')
    ).pipe(map(data => data.toString()));

    return { close, log, stdin: child.stdin };
};

it('has help command', done => {
    run('--help').close.subscribe(event => {
        expect(event[0]).toBe(0);
        done();
    }, done);
});

it('has version command', done => {
    Rx.combineLatest(
        run('--version').close,
        run('-V').close,
        run('-v').close
    ).subscribe(events => {
        expect(events[0][0]).toBe(0);
        expect(events[1][0]).toBe(0);
        expect(events[2][0]).toBe(0);
        done();
    }, done);
});

describe('exitting conditions', () => {
    it('is of success by default when running successful commands', done => {
        run('"echo foo" "echo bar"')
            .close
            .subscribe(exit => {
                expect(exit[0]).toBe(0);
                done();
            }, done);
    });

    it('is of failure by default when one of the command fails', done => {
        run('"echo foo" "exit 1"')
            .close
            .subscribe(exit => {
                expect(exit[0]).toBeGreaterThan(0);
                done();
            }, done);
    });

    it('is of success when --success=first and first command succeeds', done => {
        run('--success=first "echo foo" "exit 1"')
            .close
            .subscribe(exit => {
                expect(exit[0]).toBe(0);
                done();
            }, done);
    });

    it('is of failure when --success=first and first command fails', done => {
        run('--success=first "exit 1" "echo foo"')
            .close
            .subscribe(exit => {
                expect(exit[0]).toBeGreaterThan(0);
                done();
            }, done);
    });

    it('is of success when --success=last and last command succeeds', done => {
        run('--success=last "exit 1" "echo foo"')
            .close
            .subscribe(exit => {
                expect(exit[0]).toBe(0);
                done();
            }, done);
    });

    it('is of failure when --success=last and last command fails', done => {
        run('--success=last "echo foo" "exit 1"')
            .close
            .subscribe(exit => {
                expect(exit[0]).toBeGreaterThan(0);
                done();
            }, done);
    });

    it('is aliased to -s', done => {
        run('-s last "exit 1" "echo foo"')
            .close
            .subscribe(exit => {
                expect(exit[0]).toBe(0);
                done();
            }, done);
    });
});

describe('--raw', () => {
    it('is aliased to -r', done => {
        const child = run('-r "echo foo" "echo bar"');
        child.log.pipe(buffer(child.close)).subscribe(lines => {
            expect(lines).toHaveLength(2);
            expect(lines).toContainEqual(expect.stringContaining('foo'));
            expect(lines).toContainEqual(expect.stringContaining('bar'));
            done();
        }, done);
    });

    it('does not log any extra output', done => {
        const child = run('--raw "echo foo" "echo bar"');
        child.log.pipe(buffer(child.close)).subscribe(lines => {
            expect(lines).toHaveLength(2);
            expect(lines).toContainEqual(expect.stringContaining('foo'));
            expect(lines).toContainEqual(expect.stringContaining('bar'));
            done();
        }, done);
    });
});

describe('--names', () => {
    it('is aliased to -n', done => {
        const child = run('-n foo,bar "echo foo" "echo bar"');
        child.log.pipe(buffer(child.close)).subscribe(lines => {
            expect(lines).toContainEqual(expect.stringContaining('[foo] foo'));
            expect(lines).toContainEqual(expect.stringContaining('[bar] bar'));
            done();
        }, done);
    });

    it('prefixes with names', done => {
        const child = run('--names foo,bar "echo foo" "echo bar"');
        child.log.pipe(buffer(child.close)).subscribe(lines => {
            expect(lines).toContainEqual(expect.stringContaining('[foo] foo'));
            expect(lines).toContainEqual(expect.stringContaining('[bar] bar'));
            done();
        }, done);
    });

    it('is split using --name-separator arg', done => {
        const child = run('--names "foo|bar" --name-separator "|" "echo foo" "echo bar"');
        child.log.pipe(buffer(child.close)).subscribe(lines => {
            expect(lines).toContainEqual(expect.stringContaining('[foo] foo'));
            expect(lines).toContainEqual(expect.stringContaining('[bar] bar'));
            done();
        }, done);
    });
});

describe('--prefix', () => {
    it('is alised to -p', done => {
        const child = run('-p command "echo foo" "echo bar"');
        child.log.pipe(buffer(child.close)).subscribe(lines => {
            expect(lines).toContainEqual(expect.stringContaining('[echo foo] foo'));
            expect(lines).toContainEqual(expect.stringContaining('[echo bar] bar'));
            done();
        }, done);
    });

    it('specifies custom prefix', done => {
        const child = run('--prefix command "echo foo" "echo bar"');
        child.log.pipe(buffer(child.close)).subscribe(lines => {
            expect(lines).toContainEqual(expect.stringContaining('[echo foo] foo'));
            expect(lines).toContainEqual(expect.stringContaining('[echo bar] bar'));
            done();
        }, done);
    });
});

describe('--restart-tries', () => {
    it('changes how many times a command will restart', done => {
        const child = run('--restart-tries 1 "exit 1"');
        child.log.pipe(buffer(child.close)).subscribe(lines => {
            expect(lines).toEqual([
                expect.stringContaining('[0] exit 1 exited with code 1'),
                expect.stringContaining('[0] exit 1 restarted'),
                expect.stringContaining('[0] exit 1 exited with code 1'),
            ]);
            done();
        }, done);
    });
});

describe('--kill-others', () => {
    it('is alised to -k', done => {
        const child = run('-k "sleep 10" "exit 0"');
        child.log.pipe(buffer(child.close)).subscribe(lines => {
            expect(lines).toContainEqual(expect.stringContaining('[1] exit 0 exited with code 0'));
            expect(lines).toContainEqual(expect.stringContaining('Sending SIGTERM to other processes'));
            expect(lines).toContainEqual(expect.stringContaining(`[0] sleep 10 exited with code ${killExitCode}`));
            done();
        }, done);
    });

    it('kills on success', done => {
        const child = run('--kill-others "sleep 10" "exit 0"');
        child.log.pipe(buffer(child.close)).subscribe(lines => {
            expect(lines).toContainEqual(expect.stringContaining('[1] exit 0 exited with code 0'));
            expect(lines).toContainEqual(expect.stringContaining('Sending SIGTERM to other processes'));
            expect(lines).toContainEqual(expect.stringContaining(`[0] sleep 10 exited with code ${killExitCode}`));
            done();
        }, done);
    });

    it('kills on failure', done => {
        const child = run('--kill-others "sleep 10" "exit 1"');
        child.log.pipe(buffer(child.close)).subscribe(lines => {
            expect(lines).toContainEqual(expect.stringContaining('[1] exit 1 exited with code 1'));
            expect(lines).toContainEqual(expect.stringContaining('Sending SIGTERM to other processes'));
            expect(lines).toContainEqual(expect.stringContaining(`[0] sleep 10 exited with code ${killExitCode}`));
            done();
        }, done);
    });
});

describe('--kill-others-on-fail', () => {
    it('does not kill on success', done => {
        const child = run('--kill-others-on-fail "sleep 0.5" "exit 0"');
        child.log.pipe(buffer(child.close)).subscribe(lines => {
            expect(lines).toContainEqual(expect.stringContaining('[1] exit 0 exited with code 0'));
            expect(lines).toContainEqual(expect.stringContaining('[0] sleep 0.5 exited with code 0'));
            done();
        }, done);
    });

    it('kills on failure', done => {
        const child = run('--kill-others-on-fail "sleep 10" "exit 1"');
        child.log.pipe(buffer(child.close)).subscribe(lines => {
            expect(lines).toContainEqual(expect.stringContaining('[1] exit 1 exited with code 1'));
            expect(lines).toContainEqual(expect.stringContaining('Sending SIGTERM to other processes'));
            expect(lines).toContainEqual(expect.stringContaining(`[0] sleep 10 exited with code ${killExitCode}`));
            done();
        }, done);
    });
});

describe('--handle-input', () => {
    it('is alised to -i', done => {
        const child = run('-i "node fixtures/read-echo.js"');
        child.log.subscribe(line => {
            if (/READING/.test(line)) {
                child.stdin.write('stop\n');
            }

            if (/\[0\] stop/.test(line)) {
                done();
            }
        }, done);
    });

    it('forwards input to first process by default', done => {
        const child = run('--handle-input "node fixtures/read-echo.js"');
        child.log.subscribe(line => {
            if (/READING/.test(line)) {
                child.stdin.write('stop\n');
            }

            if (/\[0\] stop/.test(line)) {
                done();
            }
        }, done);
    });


    it('forwards input to process --default-input-target', done => {
        const lines = [];
        const child = run('-ki --default-input-target 1 "node fixtures/read-echo.js" "node fixtures/read-echo.js"');
        child.log.subscribe(line => {
            lines.push(line);
            if (/\[1\] READING/.test(line)) {
                child.stdin.write('stop\n');
            }
        }, done);

        child.close.subscribe(exit => {
            expect(exit[0]).toBeGreaterThan(0);
            expect(lines).toContainEqual(expect.stringContaining('[1] stop'));
            expect(lines).toContainEqual(expect.stringMatching(new RegExp(`\\[0\\] .*? ${killExitCode}`)));
            done();
        }, done);
    });

    it('forwards input to specified process', done => {
        const lines = [];
        const child = run('-ki "node fixtures/read-echo.js" "node fixtures/read-echo.js"');
        child.log.subscribe(line => {
            lines.push(line);
            if (/\[1\] READING/.test(line)) {
                child.stdin.write('1:stop\n');
            }
        }, done);

        child.close.subscribe(exit => {
            expect(exit[0]).toBeGreaterThan(0);
            expect(lines).toContainEqual(expect.stringContaining('[1] stop'));
            expect(lines).toContainEqual(expect.stringMatching(new RegExp(`\\[0\\] .*? ${killExitCode}`)));
            done();
        }, done);
    });
});
