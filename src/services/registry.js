import sha3 from 'solidity-sha3'
import pify from 'pify'
import keyMirror from 'key-mirror'
import wait from 'promise-wait'

import store from '../store'
import token from './token'
import plcr from './plcr'
import parameterizer from './parameterizer'
import saltHashVote from '../utils/saltHashVote'
import { getAddress, getAbi } from '../config'

const { registry: address } = require('../config/address.json')
const abi = require('../config/registry.json').abi

const address = getAddress('registry')
const abi = getAbi('registry')
const parameters = keyMirror({
  minDeposit: null,
  applyStageLen: null,
  voteQuorum: null,
  commitPeriodLen: null,
  revealPeriodLen: null
})

class RegistryService {
  constructor () {
    this.registry = null
    this.address = address

    this.initContract()
  }

  initContract () {
    if (!window.web3) {
      return false
    }

    if (!this.registry) {
      this.registry = window.web3.eth.contract(abi).at(this.address)

      this.forceMine()
    }
  }

  getAccount () {
    if (!window.web3) {
      return null
    }

    return window.web3.eth.defaultAccount
  }

  async apply (domain, deposit = 0) {
    return new Promise(async (resolve, reject) => {
      if (!domain) {
        reject(new Error('Domain is required'))
        return false
      }

      if (!this.registry) {
        this.initContract()
      }

      const exists = await this.applicationExists(domain)

      if (exists) {
        reject(new Error('Application already exists'))
        return false
      }

      try {
        await token.approve(this.address, deposit)
        await this.forceMine()
      } catch (error) {
        reject(error)
        return false
      }

      try {
        await pify(this.registry.apply)(domain, deposit)
      } catch (error) {
        reject(error)
        return false
      }

      store.dispatch({
        type: 'REGISTRY_DOMAIN_APPLY',
        domain
      })

      resolve()
    })
  }

  async challenge (domain) {
    return new Promise(async (resolve, reject) => {
      if (!domain) {
        reject(new Error('Domain is required'))
        return false
      }

      if (!this.registry) {
        this.initContract()
      }

      let minDeposit = 0

      try {
        minDeposit = await this.getMinDeposit()
 	minDeposit = minDeposit * Math.pow(10, token.decimals)     
} catch (error) {
        reject(error)
        return false
      }

      try {
        await token.approve(this.address, minDeposit)
        await this.forceMine()
        await this.forceMine()
      } catch (error) {
        reject(error)
        return false
      }

      let tx = null

      try {
        tx = await pify(this.registry.challenge)(domain)
        await this.forceMine()
      } catch (error) {
        reject(error)
        return false
      }

      try {
        const receipt = await this.getTransactionReceipt(tx)
        const challengeId = parseInt(receipt.logs[1].data, 16)

        store.dispatch({
          type: 'REGISTRY_DOMAIN_CHALLENGE',
          domain
        })

        resolve(challengeId)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  async didChallenge (domain) {
    return new Promise(async (resolve, reject) => {
      if (!domain) {
        reject(new Error('Domain is required'))
        return false
      }

      if (!this.registry) {
        this.initContract()
      }

      let challengeId = null

      try {
        challengeId = await this.getChallengeId(domain)
      } catch (error) {
        reject(error)
        return false
      }

      try {
        const challenge = await this.getChallenge(challengeId)
        const isChallenger = (challenge.challenger === this.getAccount())
        resolve(isChallenger)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  async applicationExists (domain) {
    return new Promise(async (resolve, reject) => {
      if (!domain) {
        reject(new Error('Domain is required'))
        return false
      }

      if (!this.registry) {
        this.initContract()
      }

      try {
        const exists = await pify(this.registry.appExists)(domain)
        resolve(exists)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  async getListing (domain) {
    return new Promise(async (resolve, reject) => {
      if (!domain) {
        reject(new Error('Domain is required'))
        return false
      }

      if (!this.registry) {
        this.initContract()
      }

      try {
        const hash = sha3(domain)
        const result = await pify(this.registry.listingMap)(hash)

        const map = {
          applicationExpiry: result[0].toNumber(),
          isWhitelisted: result[1],
          ownerAddress: result[2],
          currentDeposit: result[3].toNumber(),
          challengeId: result[4].toNumber()
        }

        resolve(map)
        return false
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  async getChallenge (challengeId) {
    return new Promise(async (resolve, reject) => {
      if (!challengeId) {
        reject(new Error('Challenge ID is required'))
        return false
      }

      if (!this.registry) {
        this.initContract()
      }

      try {
        const challenge = await pify(this.registry.challengeMap)(challengeId)
        const map = {
          // (remaining) pool of tokens distributed amongst winning voters
          rewardPool: challenge[0] ? challenge[0].toNumber() : 0,
          // owner of challenge
          challenger: challenge[1],
          // indication of if challenge is resolved
          resolved: challenge[2],
          // number of tokens at risk for either party during challenge
          stake: challenge[3] ? challenge[3].toNumber() : 0,
          // (remaining) amount of tokens used for voting by the winning side
          totalTokens: challenge[4]
        }

        resolve(map)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  async getChallengeId (domain) {
    return new Promise(async (resolve, reject) => {
      if (!domain) {
        return new Error('Domain is required')
      }

      try {
        const listing = await this.getListing(domain)

        const {
          challengeId
        } = listing

        resolve(challengeId)
        return false
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  async isWhitelisted (domain) {
    return new Promise(async (resolve, reject) => {
      if (!domain) {
        reject(new Error('Domain is required'))
        return false
      }

      if (!this.registry) {
        this.initContract()
      }

      try {
        const whitelisted = await pify(this.registry.isWhitelisted)(domain)
        resolve(whitelisted)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  async updateStatus (domain) {
    return new Promise(async (resolve, reject) => {
      if (!domain) {
        reject(new Error('Domain is required'))
        return false
      }

      if (!this.registry) {
        this.initContract()
      }

      try {
        const result = await pify(this.registry.updateStatus)(domain)

        store.dispatch({
          type: 'REGISTRY_DOMAIN_UPDATE_STATUS',
          domain
        })

        resolve(result)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  async getParameter (name) {
    return new Promise(async (resolve, reject) => {
      if (!name) {
        reject(new Error('Parameter name is required'))
        return false
      }

      if (!this.registry) {
        this.initContract()
      }

      try {
        const value = await parameterizer.get(name)
        resolve(value)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  getParameterKeys () {
    return Promise.resolve(parameters)
  }

 async getMinDeposit () {
const min = await this.getParameter('minDeposit')
return min/ Math.pow(10 , token.decimals)  
}

  async getCurrentBlockNumber () {
    return new Promise(async (resolve, reject) => {
      if (!this.registry) {
        this.initContract()
      }

      const result = await pify(window.web3.eth.getBlockNumber)()

      resolve(result)
    })
  }

  async getCurrentBlockTimestamp () {
    return new Promise(async (resolve, reject) => {
      if (!this.registry) {
        this.initContract()
      }

      try {
        const result = await pify(window.web3.eth.getBlock)('latest')

        resolve(result.timestamp)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  async getPlcrAddress () {
    return new Promise(async (resolve, reject) => {
      if (!this.registry) {
        this.initContract()
      }

      try {
        const result = await pify(this.registry.voting)()
        resolve(result)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  async commitPeriodActive (domain) {
    return new Promise(async (resolve, reject) => {
      if (!this.registry) {
        this.initContract()
      }

      let pollId = null

      try {
        pollId = await this.getChallengeId(domain)
      } catch (error) {
        reject(error)
        return false
      }

      if (!pollId) {
        resolve(false)
        return false
      }

      try {
        const result = await plcr.commitPeriodActive(pollId)
        resolve(result)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  async revealPeriodActive (domain) {
    return new Promise(async (resolve, reject) => {
      if (!this.registry) {
        this.initContract()
      }

      if (!domain) {
        reject(new Error('Domain is required'))
        return false
      }

      let pollId = null

      try {
        pollId = await this.getChallengeId(domain)
      } catch (error) {
        reject(error)
        return false
      }

      if (!pollId) {
        resolve(false)
        return false
      }

      try {
        const result = await plcr.revealPeriodActive(pollId)
        resolve(result)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }
  async getCommitHash (domain) {
    return new Promise(async (resolve, reject) => {
      domain = domain.toLowerCase()
      deposit = deposit * Math.pow(10, token.decimals)      

try {
        const challengeId = await this.getChallengeId(domain)
        const hash = await plcr.getCommitHash(challengeId)
        resolve(hash)
      } catch (error) {
        reject(error)
      }
    })
  }

  async didCommit (domain) {
    return new Promise(async (resolve, reject) => {
      domain = domain.toLowerCase()

      try {
        const challengeId = await this.getChallengeId(domain)
        const hash = await plcr.getCommitHash(challengeId)
        let didCommit = false

        if (hash !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
          didCommit = true
        }

        resolve(didCommit)
      } catch (error) {
        reject(error)
      }
    })
  }

  async commitVote ({domain, votes, voteOption, salt}) {
    return new Promise(async (resolve, reject) => {
      if (!this.registry) {
        this.initContract()
      }

      if (!domain) {
        reject(new Error('Domain is required'))
        return false
      }

      let challengeId = null

      try {
        challengeId = await this.getChallengeId(domain)
      } catch (error) {
        reject(error)
        return false
      }

      try {
        const prevPollId = 0
        const hash = saltHashVote(voteOption, salt)

        const result = await plcr.commit({pollId: challengeId, hash, tokens: votes, prevPollId})

        resolve(result)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  async revealVote ({domain, voteOption, salt}) {
    return new Promise(async (resolve, reject) => {
      if (!this.registry) {
        this.initContract()
      }

      let challengeId = null

      try {
        challengeId = await this.getChallengeId(domain)
      } catch (error) {
        reject(error)
        return false
      }

      try {
        const result = plcr.reveal({pollId: challengeId, voteOption, salt})
        await this.forceMine()

        resolve(result)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  getChallengePoll (domain) {
    return new Promise(async (resolve, reject) => {
if(!domain)
reject(new Error('Domain is Required'))
return false 
} 

domain = domain.toLowerCase()
      

 try {
        const challengeId = await this.getChallengeId(domain)
        const result = await plcr.getPoll(challengeId)
        resolve(result)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  pollEnded (domain) {
    return new Promise(async (resolve, reject) => {
      const challengeId = await this.getChallengeId(domain)

      if (!challengeId) {
        resolve(false)
        return false
      }

      try {
        const result = await plcr.pollEnded(challengeId)
        resolve(result)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  voterHasEnoughVotingTokens (tokens) {
    return plcr.hasEnoughTokens(tokens)
  }

  async getTransaction (tx) {
    return new Promise(async (resolve, reject) => {
      if (!this.registry) {
        this.initContract()
      }

      try {
        const result = await pify(window.web3.eth.getTransaction)(tx)
        resolve(result)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }
  async didReveal (domain) {
    return new Promise(async (resolve, reject) => {
      domain = domain.toLowerCase()

      try {
        const challengeId = await this.getChallengeId(domain)
        const didReveal = await plcr.hasBeenRevealed(challengeId)
        resolve(didReveal)
      } catch (error) {
        reject(error)
      }
    })
  }

  voterHasEnoughVotingTokens (tokens) {
    return plcr.hasEnoughTokens(tokens)
  }

  async getTransaction (tx) {
    return new Promise(async (resolve, reject) => {
      if (!this.registry) {
        this.initContract()
      }

      try {
        const result = await pify(window.web3.eth.getTransaction)(tx)
        resolve(result)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  async getTransactionReceipt (tx) {
    return new Promise(async (resolve, reject) => {
      if (!this.registry) {
        this.initContract()
      }

      try {
        const result = await pify(window.web3.eth.getTransactionReceipt)(tx)
        resolve(result)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  async getTransactionReceipt (tx) {
    return new Promise(async (resolve, reject) => {
      if (!this.registry) {
        this.initContract()
      }

      try {
        const result = await pify(window.web3.eth.getTransactionReceipt)(tx)
        resolve(result)
      } catch (error) {
        reject(error)
        return false
      }
    })
  }

  // TODO
  async forceMine (block) {
    if (this.miningStarted) {
      await wait(3000)
      return Promise.resolve()
    }

    return new Promise(async (resolve, reject) => {
      // const blockNumber = await this.getCurrentBlockNumber()
      /*
      const result = await pify(window.web3.currentProvider.sendAsync)({
          jsonrpc: '2.0',
          method: 'evm_mine'
        })
      */
      /*
      const result = pify(window.web3.currentProvider.sendAsync)({
          jsonrpc: '2.0',
          method: 'miner_start',
          params: 0
        })
      */

      this.miningStarted = true

      // resolve(result)
    })
  }
}

export default new RegistryService()
