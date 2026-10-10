import { GetDb } from '../db';
import { HuntRegion, SetRegionReader } from './huntregion';

export function GetHuntRegion(userId: string): HuntRegion {
    const row = GetDb().$client.prepare('SELECT region FROM huntregions WHERE userId = ?').get(userId) as {region:string} | undefined;
    return row?.region === 'aus' || row?.region === 'ger' || row?.region === 'us' ? row.region : 'main';
}
export function SaveHuntRegion(userId: string, region: HuntRegion) {
    GetDb().$client.prepare('INSERT INTO huntregions (userId, region) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET region = excluded.region').run(userId, region);
}
SetRegionReader(GetHuntRegion);
