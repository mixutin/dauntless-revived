// Probes receive no credentials: the launcher measures TCP handshakes only.
export function RegionProbes() {
    return (['main','aus','ger','us'] as const).flatMap(region => {
        if (region === 'aus' && process.env.AUS_REGION !== '1') return [];
        if (region === 'ger' && process.env.GERMANY_REGION !== '1') return [];
        if (region === 'us' && process.env.US_REGION !== '1') return [];
        const prefix = `REGION_${region.toUpperCase()}_PROBE`;
        const host = process.env[`${prefix}_HOST`];
        const port = Number(process.env[`${prefix}_PORT`] ?? 443);
        if (!host) return [];
        if (!/^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/.test(host) || !Number.isInteger(port) || port<1 || port>65535)
            throw new Error(`Invalid ${prefix} endpoint`);
        return [{region,host,port}];
    });
}
