import path from 'node:path'
import { startWorker } from './worker.ts'

const dataDir = process.env.VAE_DATA_DIR ? path.resolve(process.env.VAE_DATA_DIR) : path.resolve(import.meta.dirname, '../../data')
const worker = startWorker({ dataDir })
console.log(`[worker] 시작했어요 — 데이터 폴더: ${dataDir}`)

let stopping = false
const shutdown = () => {
  if (stopping) {
    console.log('[worker] 바로 종료해요 (진행 중이던 작업은 다음 시작 때 "중단됨"으로 표시돼요)')
    process.exit(1)
  }
  stopping = true
  console.log('[worker] 진행 중인 작업을 끝내고 종료해요 (한 번 더 누르면 바로 종료)')
  void worker.stop().then(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
