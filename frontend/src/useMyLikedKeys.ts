// frontend/src/useMyLikedKeys.ts
import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

interface LikedKeyRow {
  keeper_1_id: number
  burner_1_id: number
  keeper_2_id: number
  burner_2_id: number
}

export function likedKey(k1: string | number, b1: string | number, k2: string | number, b2: string | number): string {
  return `${k1}-${b1}-${k2}-${b2}`
}

export function useMyLikedKeys(wallet: string | undefined) {
  const [likedKeys, setLikedKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!wallet || !supabase) {
      setLikedKeys(new Set())
      return
    }
    supabase
      .rpc('get_my_liked_keys', { p_wallet: wallet.toLowerCase() })
      .then(({ data, error }) => {
        if (error || !data) return
        const keys = new Set<string>(
          (data as LikedKeyRow[]).map(r =>
            likedKey(r.keeper_1_id, r.burner_1_id, r.keeper_2_id, r.burner_2_id)
          )
        )
        setLikedKeys(keys)
      })
  }, [wallet])

  return { likedKeys, setLikedKeys }
}
