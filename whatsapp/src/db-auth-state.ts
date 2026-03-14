import type { Pool } from 'pg';
import * as baileys from '@whiskeysockets/baileys';
const { proto, initAuthCreds, BufferJSON } = (baileys as any).default ?? baileys;
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';

export async function usePostgresAuthState(pool: Pool, userId: string): Promise<{
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
}> {
    // Load or create creds
    const credsRow = await pool.query(
        'SELECT creds_json FROM auth_creds WHERE user_id = $1',
        [userId]
    );

    let creds: AuthenticationCreds;
    if (credsRow.rows.length > 0) {
        creds = JSON.parse(JSON.stringify(credsRow.rows[0].creds_json), BufferJSON.reviver);
    } else {
        creds = initAuthCreds();
    }

    const saveCreds = async () => {
        const credsJson = JSON.parse(JSON.stringify(creds, BufferJSON.replacer));
        await pool.query(
            `INSERT INTO auth_creds (user_id, creds_json, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (user_id)
             DO UPDATE SET creds_json = $2, updated_at = NOW()`,
            [userId, JSON.stringify(credsJson)]
        );
    };

    const state: AuthenticationState = {
        creds,
        keys: {
            get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
                const result: { [id: string]: SignalDataTypeMap[T] } = {};
                if (ids.length === 0) return result;

                const rows = await pool.query(
                    'SELECT key_id, key_json FROM auth_keys WHERE user_id = $1 AND category = $2 AND key_id = ANY($3)',
                    [userId, type, ids]
                );

                for (const row of rows.rows) {
                    let value = JSON.parse(JSON.stringify(row.key_json), BufferJSON.reviver);
                    if (type === 'app-state-sync-key' && value) {
                        value = proto.Message.AppStateSyncKeyData.fromObject(value);
                    }
                    result[row.key_id] = value;
                }

                return result;
            },
            set: async (data: Record<string, Record<string, any>>) => {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            if (value) {
                                const jsonValue = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
                                await client.query(
                                    `INSERT INTO auth_keys (user_id, category, key_id, key_json)
                                     VALUES ($1, $2, $3, $4)
                                     ON CONFLICT (user_id, category, key_id)
                                     DO UPDATE SET key_json = $4`,
                                    [userId, category, id, JSON.stringify(jsonValue)]
                                );
                            } else {
                                await client.query(
                                    'DELETE FROM auth_keys WHERE user_id = $1 AND category = $2 AND key_id = $3',
                                    [userId, category, id]
                                );
                            }
                        }
                    }
                    await client.query('COMMIT');
                } catch (err) {
                    await client.query('ROLLBACK');
                    throw err;
                } finally {
                    client.release();
                }
            }
        }
    };

    return { state, saveCreds };
}
