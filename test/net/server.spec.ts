/**
 * Copyright (C) 2021 diva.exchange
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Author/Maintainer: Konrad Bächler <konrad@diva.exchange>
 */

import { suite, test, slow, timeout } from '@testdeck/mocha';
import chai, { expect } from 'chai';
import chaiHttp from 'chai-http';
import path from 'path';

import { Server } from '../../src/net/server';
import { Config, Configuration } from '../../src/config';
import { BlockStruct } from '../../src/chain/block';
import { Blockchain } from '../../src/chain/blockchain';
import { CommandAddPeer, CommandModifyStake } from '../../src/chain/transaction';
import { Wallet } from '../../src/chain/wallet';
import fs from 'fs';

chai.use(chaiHttp);

const SIZE_TESTNET = 7;
const BASE_PORT = 17000;
const IP = '127.27.27.1';

@suite
class TestServer {
  static mapConfigServer: Map<string, Configuration> = new Map();
  static mapServer: Map<string, Server> = new Map();

  @timeout(20000)
  static before(): Promise<void> {
    // create a genesis block
    const genesis: BlockStruct = Blockchain.genesis(path.join(__dirname, '../../genesis/block.json'));

    const cmds: Array<CommandAddPeer | CommandModifyStake> = [];
    let s = 1;
    for (let i = 1; i <= SIZE_TESTNET; i++) {
      const config = new Config({
        ip: IP,
        port: BASE_PORT + i,
        path_genesis: path.join(__dirname, '../genesis/block.json'),
        path_state: path.join(__dirname, '../state'),
        path_blockstore: path.join(__dirname, '../blockstore'),
        path_keys: path.join(__dirname, '../keys'),
        network_size: 5,
        network_morph_interval_ms: 30000,
        network_clean_interval_ms: 20000,
      });

      const publicKey = Wallet.make(config).getPublicKey();
      this.mapConfigServer.set(publicKey, config);

      cmds.push({
        seq: s,
        command: 'addPeer',
        host: IP,
        port: BASE_PORT + i,
        publicKey: publicKey,
      } as CommandAddPeer);
      s++;
      cmds.push({
        seq: s,
        command: 'modifyStake',
        publicKey: publicKey,
        stake: 1000,
      } as CommandModifyStake);
      s++;
    }
    genesis.tx = [
      {
        ident: 'genesis',
        origin: '0000000000000000000000000000000000000000000',
        timestamp: 88355100000,
        commands: cmds,
        sig: '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      },
    ];
    fs.writeFileSync(path.join(__dirname, '../genesis/block.json'), JSON.stringify(genesis));

    return new Promise((resolve) => {
      setTimeout(resolve, 9000);

      for (const pk of TestServer.mapConfigServer.keys()) {
        (async () => {
          await TestServer.createServer(pk);
        })();
      }
    });
  }

  @timeout(60000)
  static after(): Promise<void> {
    return new Promise((resolve) => {
      let c = TestServer.mapServer.size;
      TestServer.mapServer.forEach(async (s) => {
        await s.shutdown();
        c--;
        if (!c) {
          setTimeout(resolve, 500);
        }
      });
    });
  }

  static async createServer(publicKey: string) {
    const s = new Server(
      new Config({
        ...TestServer.mapConfigServer.get(publicKey),
        ...{
          path_genesis: path.join(__dirname, '../genesis/block.json'),
          path_blockstore: path.join(__dirname, '../blockstore'),
          path_state: path.join(__dirname, '../state'),
          path_keys: path.join(__dirname, '../keys'),
        },
      })
    );
    await s.start();
    TestServer.mapServer.set(publicKey, s);
    return s;
  }

  @test
  async default404() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/');
    expect(res).to.have.status(404);
  }

  @test
  async transaction() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const token = fs.readFileSync(config.path_api_token || '').toString();
    const res = await chai
      .request(`http://${config.ip}:${config.port}`)
      .put('/transaction')
      .set('api-token', token)
      .send([{ seq: 1, command: 'testLoad', timestamp: Date.now() }]);
    expect(res).to.have.status(200);
  }

  @test
  async transactionFails() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai
      .request(`http://${config.ip}:${config.port}`)
      .put('/transaction')
      .send([{ seq: 1, command: 'testLoad', timestamp: Date.now() }]);
    expect(res).to.have.status(403);
  }

  @test
  async peers() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/peers');
    expect(res).to.have.status(200);
  }

  @test
  async network() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/network');
    expect(res).to.have.status(200);
  }

  @test
  async gossip() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/gossip');
    expect(res).to.have.status(200);
  }

  @test
  async stackTransactions() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/stack/transactions');
    expect(res).to.have.status(200);
  }

  @test
  async poolTransactions() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/pool/transactions');
    expect(res).to.have.status(200);
  }

  @test
  async poolVotes() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/pool/votes');
    expect(res).to.have.status(200);
  }

  @test
  async poolCommits() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/pool/commits');
    expect(res).to.have.status(200);
  }

  @test
  async poolBlocks() {
    const config = [...TestServer.mapConfigServer.values()][0];
    const res = await chai.request(`http://${config.ip}:${config.port}`).get('/pool/blocks');
    expect(res).to.have.status(200);
  }

  @test
  async blocks() {
    const config = [...TestServer.mapConfigServer.values()][0];
    let res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks?limit=1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks?gte=1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks?lte=1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks?gte=-1&lte=1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks?gte=1&lte=-1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks?gte=1&lte=2');
    expect(res).to.have.status(200);
  }

  @test
  async page() {
    const config = [...TestServer.mapConfigServer.values()][0];
    let res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks/page/1');
    expect(res).to.have.status(200);

    res = await chai.request(`http://${config.ip}:${config.port}`).get('/blocks/page/1?size=1');
    expect(res).to.have.status(200);
  }

  @test
  @slow(25000)
  @timeout(30000)
  async stressMultiTransaction() {
    const _outer = 20;
    const _inner = 20;

    // create blocks containing multiple transactions
    let seq = 1;
    const arrayConfig = [...TestServer.mapConfigServer.values()];
    const arrayOrigin = [...TestServer.mapConfigServer.keys()];
    const arrayRequests: Array<string> = [];

    for (let _i = 0; _i < _outer; _i++) {
      const aT: Array<any> = [];
      for (let _j = 0; _j < _inner; _j++) {
        aT.push({ seq: seq++, command: 'testLoad', timestamp: Date.now() });
      }
      const i = Math.floor(Math.random() * (arrayConfig.length - 1));
      const token = fs.readFileSync(arrayConfig[i].path_api_token || '').toString();
      arrayRequests.push(arrayOrigin[i]);
      await chai
        .request(`http://${arrayConfig[i].ip}:${arrayConfig[i].port}`)
        .put(`/transaction/seq${_i}`)
        .set('api-token', token)
        .send(aT);
    }

    // wait a bit
    await new Promise((resolve) => {
      setTimeout(resolve, 20000);
    });

    for (let _i = 0; _i < _outer; _i++) {
      const origin = arrayRequests.shift();
      const i = Math.floor(Math.random() * (arrayConfig.length - 1));
      const res = await chai
        .request(`http://${arrayConfig[i].ip}:${arrayConfig[i].port}`)
        .get(`/transaction/${origin}/seq${_i}`);
      expect(res.status).eq(200);
      expect(res.body.ident).eq(`seq${_i}`);
      expect(res.body.commands.length).eq(_inner);
    }
  }
}
