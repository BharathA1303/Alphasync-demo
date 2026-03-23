import { cn } from '../../utils/cn';

const variants = {
    default: 'bg-surface-700 text-gray-600 border border-edge/10',
    primary: 'bg-primary-600/15 text-primary-600 border border-primary-500/20',
    success: 'bg-green-500/10 text-green-400 border border-green-500/20',
    danger: 'bg-red-500/10 text-red-500 border border-red-500/20',
    warning: 'bg-[#0EA5E9]/10 text-[#0EA5E9] border border-[#0EA5E9]/20',
    bull: 'bg-bull/10 text-bull border border-bull/20',
    bear: 'bg-bear/10 text-bear border border-bear/20',
};

/**
 * Status/label badge.
 * @param {{ variant?: keyof variants, dot?: boolean }} props
 */
export default function Badge({ variant = 'default', dot = false, className, children }) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full',
                variants[variant],
                className
            )}
        >
            {dot && (
                <span className={cn('w-1.5 h-1.5 rounded-full', {
                    'bg-primary-400': variant === 'primary',
                    'bg-green-400': variant === 'success',
                    'bg-red-400': variant === 'danger',
                    'bg-[#0EA5E9]': variant === 'warning',
                    'bg-bull': variant === 'bull',
                    'bg-bear': variant === 'bear',
                    'bg-gray-400': variant === 'default',
                })} />
            )}
            {children}
        </span>
    );
}
