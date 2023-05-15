export const presentState = (state: string): string => state.replace('_', ' ').toLowerCase();

export const serializeError = (error: any): string => {
    if (typeof error === 'string') {
        return error;
    } else {
        return JSON.stringify(error);
    }
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));