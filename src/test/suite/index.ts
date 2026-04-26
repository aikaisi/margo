// Copyright (c) 2026 Abbas Al-Kaisi. Licensed under AGPL-3.0-only. See LICENSE.
import * as path from 'path';
import Mocha from 'mocha';
import * as fs from 'fs';

export function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'tdd', color: true });
    const testsRoot = path.resolve(__dirname, '.');

    return new Promise((resolve, reject) => {
        const testFiles = fs.readdirSync(testsRoot)
            .filter((f: string) => f.endsWith('.test.js'));

        testFiles.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

        try {
            mocha.run((failures: number) => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
        } catch (err) {
            reject(err);
        }
    });
}
