import flipkartLogo from '../assets/logos/flipkart.png';
import shopsyLogo from '../assets/logos/shopsy.png';
import zeptoLogo from '../assets/logos/zepto.png';
import vivoLogo from '../assets/logos/vivo.png';
import realmeLogo from '../assets/logos/realme.png';
import blinkitLogo from '../assets/logos/blinkit.png';
import oppoLogo from '../assets/logos/oppo.png';
import iqooLogo from '../assets/logos/iqoo.png';
import vijaysalesLogo from '../assets/logos/vijaysales.png';
import samsungLogo from '../assets/logos/samsung.png';
import relianceLogo from '../assets/logos/reliance.png';
import xiaomiLogo from '../assets/logos/xiaomi.png';
import oneplusLogo from '../assets/logos/oneplus.png';

// Common props
interface IconProps {
    size?: number;
    className?: string; // Still accepted but might be less useful for img unless standard sizing
}

export const FlipkartIcon = ({ size = 24, className = "" }: IconProps) => (
    <img
        src={flipkartLogo}
        width={size}
        height={size}
        alt="Flipkart"
        className={`object-contain ${className}`}
    />
);

export const ShopsyIcon = ({ size = 24, className = "" }: IconProps) => (
    <img
        src={shopsyLogo}
        width={size}
        height={size}
        alt="Shopsy"
        className={`object-contain ${className}`}
    />
);

export const AmazonIcon = ({ size = 24, className = "" }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
        <path d="M13.6 15.6c0.8-1.1 1.6-2.5 1.9-3.4 0.1-0.3 0.1-0.6-0.2-0.7 -0.3-0.1-0.6 0.2-0.8 0.5 -1.1 1.7-2.6 3.1-4.2 4.1 -0.4 0.2-0.8 0.4-1.3 0.6 -0.1 0-0.2 0-0.3 0 -0.4 0-0.8-0.3-0.8-0.8 0-0.3 0.2-0.6 0.4-0.8 0.1-0.1 0.3-0.1 0.4-0.2 1.9-0.9 3.4-2.2 4.5-3.8 0.2-0.3 0.4-0.6 0.5-0.9 0.1-0.3 0.3-0.5 0.6-0.5 0.4 0 0.8 0.3 0.8 0.7 0 0.2 0 0.3-0.1 0.5 -0.3 0.9-1.3 2.5-2.2 3.8 -0.1 0.2-0.3 0.3-0.5 0.3 -0.2 0-0.3-0.1-0.4-0.3z" />
        <path d="M19.9 14.8c-0.2-0.1-0.4-0.1-0.5 0.1 -0.6 0.8-1.4 1.5-2.2 1.9 -0.3 0.1-0.5 0.4-0.5 0.7 0 0.3 0.2 0.6 0.5 0.6 0 0 0.1 0 0.1 0 1.1-0.5 2-1.3 2.8-2.3 0.2-0.2 0.1-0.6-0.2-0.8z" />
        <path d="M2.5 16.4c0-0.4 0.3-0.8 0.8-0.8 0.1 0 0.3 0 0.4 0.1 1.6 0.5 3.3 0.8 5 0.8 3.5 0 6.7-1.3 9.2-3.6 0.3-0.3 0.8-0.3 1.1 0 0.3 0.3 0.3 0.8 0 1.1 -2.7 2.6-6.4 4.1-10.2 4.1 -1.9 0-3.8-0.4-5.6-1 -0.2-0.1-0.4-0.3-0.6-0.5 -0.1-0.1-0.1-0.2-0.1-0.2z" />
    </svg>
);

export const BlinkitIcon = ({ size = 24, className = "" }: IconProps) => (
    <img
        src={blinkitLogo}
        width={size}
        height={size}
        alt="Blinkit"
        className={`object-contain ${className}`}
    />
);

export const RelianceIcon = ({ size = 24, className = "" }: IconProps) => (
    <img
        src={relianceLogo}
        width={size}
        height={size}
        alt="Reliance Digital"
        className={`object-contain ${className}`}
    />
);

export const ZeptoIcon = ({ size = 24, className = "" }: IconProps) => (
    <img
        src={zeptoLogo}
        width={size}
        height={size}
        alt="Zepto"
        className={`object-contain ${className}`}
    />
);

export const SamsungIcon = ({ size = 24, className = "" }: IconProps) => (
    <img
        src={samsungLogo}
        width={size}
        height={size}
        alt="Samsung"
        className={`object-contain ${className}`}
    />
);

export const OnePlusIcon = ({ size = 24, className = "" }: IconProps) => (
    <img
        src={oneplusLogo}
        width={size}
        height={size}
        alt="OnePlus"
        className={`object-contain ${className}`}
    />
);

export const VivoIcon = ({ size = 24, className = "" }: IconProps) => (
    <img
        src={vivoLogo}
        width={size}
        height={size}
        alt="Vivo"
        className={`object-contain ${className}`}
    />
);

export const OppoIcon = ({ size = 24, className = "" }: IconProps) => (
    <img
        src={oppoLogo}
        width={size}
        height={size}
        alt="Oppo"
        className={`object-contain ${className}`}
    />
);

export const RedmiIcon = ({ size = 24, className = "" }: IconProps) => (
    <img
        src={xiaomiLogo}
        width={size}
        height={size}
        alt="Xiaomi"
        className={`object-contain ${className}`}
    />
);

export const RealmeIcon = ({ size = 24, className = "" }: IconProps) => (
    <img
        src={realmeLogo}
        width={size}
        height={size}
        alt="Realme"
        className={`object-contain ${className}`}
    />
);

export const IQOOIcon = ({ size = 24, className = "" }: IconProps) => (
    <img
        src={iqooLogo}
        width={size}
        height={size}
        alt="iQOO"
        className={`object-contain ${className}`}
    />
);

export const VijaySalesIcon = ({ size = 24, className = "" }: IconProps) => (
    <img
        src={vijaysalesLogo}
        width={size}
        height={size}
        alt="Vijay Sales"
        className={`object-contain ${className}`}
    />
);

export const GenericPlatformIcon = ({ name, className = "" }: { name: string, className?: string }) => (
    <div className={`flex items-center justify-center bg-slate-100 rounded-lg text-xs font-bold text-slate-500 uppercase ${className}`}>
        {name.substring(0, 2)}
    </div>
);

export const PlatformIcon = ({ name, size = 20, className = "" }: { name: string; size?: number; className?: string }) => {
    const platform = name.toLowerCase();

    switch (platform) {
        case 'flipkart': return <FlipkartIcon size={size} className={className} />;
        case 'shopsy': return <ShopsyIcon size={size} className={className} />;
        case 'amazon': return <AmazonIcon size={size} className={className} />;
        case 'blinkit': return <BlinkitIcon size={size} className={className} />;
        case 'reliance': return <RelianceIcon size={size} className={className} />;
        case 'reliancedigital': return <RelianceIcon size={size} className={className} />;
        case 'zepto': return <ZeptoIcon size={size} className={className} />;
        case 'samsung': return <SamsungIcon size={size} className={className} />;
        case 'oneplus': return <OnePlusIcon size={size} className={className} />;
        case 'vivo': return <VivoIcon size={size} className={className} />;
        case 'oppo': return <OppoIcon size={size} className={className} />;
        case 'redmi': return <RedmiIcon size={size} className={className} />;
        case 'xiaomi': return <RedmiIcon size={size} className={className} />;
        case 'realme': return <RealmeIcon size={size} className={className} />;
        case 'iqoo': return <IQOOIcon size={size} className={className} />;
        case 'vijaysales': return <VijaySalesIcon size={size} className={className} />;
        default: return <GenericPlatformIcon name={name} className={className} />;
    }
};
