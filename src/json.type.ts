interface Address {
    streetAddress: string;
    postalCode: string;
    addressLocality: string;
    addressRegion: string;
}

interface AggregateRating {
    reviewCount: number;
    ratingValue: string;
    worstRating: number;
    bestRating: number;
}

interface Domain {
    logo: string;
    url: string;
    name: string;
    image: string;
    address: Address;
    aggregateRating: AggregateRating;
}

interface DomainInfo {
    city: string;
    region: string;
    postalCode: string;
    url: string;
    name: string;
}

interface CompleteDomainInfo {
    city: string;
    region: string;
    postalCode: string;
    url: string;
    name: string;
    min: number;
    max: number;
}
